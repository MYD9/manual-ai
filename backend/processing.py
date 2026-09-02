import hashlib
import html
import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import threading
import time
import sys
from contextlib import closing
from pathlib import Path
from urllib.parse import urlparse, urljoin
import httpx
import numpy as np
from PIL import Image
from sqlalchemy import select
from backend.models import Chunk, Entry, Job, Vector, now
from backend.indexing import eligible, replace_chunks
from backend.providers import embedding_batch_size, embeddings, space_for

MAX_BYTES = 50 * 1024 * 1024
ALLOWED = {".pdf", ".doc", ".docx", ".png", ".jpg", ".jpeg", ".webp", ".bmp", ".txt", ".md"}
_ocr = None


def libreoffice(config=None):
    configured = (config or {}).get("libreoffice_path", "")
    paths = [configured, shutil.which("soffice") or "", r"C:\Program Files\LibreOffice\program\soffice.exe", r"C:\Program Files (x86)\LibreOffice\program\soffice.exe"]
    return next((p for p in paths if p and Path(p).is_file()), None)


def ocr_image(image):
    global _ocr
    if _ocr is None:
        from rapidocr import RapidOCR
        _ocr = RapidOCR()
    output = _ocr(np.asarray(image.convert("RGB")))
    texts = output.txts or []
    boxes = output.boxes.tolist() if output.boxes is not None else []
    return "\n".join(texts), boxes


def safe_url(value):
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
        raise ValueError("仅支持公开 HTTP/HTTPS 网页")
    try:
        addresses = socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror:
        raise ValueError("无法解析网页地址") from None
    if any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
        raise ValueError("网页导入不允许访问本机或内网地址")
    return value


def fetch_web(value):
    with httpx.Client(timeout=30, follow_redirects=False, trust_env=False) as client:
        for _ in range(6):
            safe_url(value)
            target = httpx.URL(value)
            addresses = socket.getaddrinfo(target.host, target.port or (443 if target.scheme == "https" else 80), type=socket.SOCK_STREAM)
            if not addresses or any(not ipaddress.ip_address(a[4][0]).is_global for a in addresses):
                raise ValueError("网页导入不允许访问本机或内网地址")
            # Connect to the validated IP while retaining the original TLS/HTTP host.
            pinned = target.copy_with(host=addresses[0][4][0])
            with client.stream("GET", pinned, headers={"Host": target.netloc.decode("ascii"), "User-Agent": "ManualAI/1.0 personal-document-reader"}, extensions={"sni_hostname": target.host}) as response:
                if response.is_redirect:
                    value = urljoin(value, response.headers.get("location", ""))
                    continue
                if response.status_code >= 400:
                    raise ValueError(f"网页返回 HTTP {response.status_code}，可改用粘贴文字或 PDF")
                kind = response.headers.get("content-type", "")
                if "html" not in kind and "text/plain" not in kind:
                    raise ValueError("链接不是网页，请下载文件后导入")
                raw = bytearray()
                for part in response.iter_bytes():
                    raw.extend(part)
                    if len(raw) > 10 * 1024 * 1024:
                        raise ValueError("网页过大，请保存为 PDF 后导入")
                return bytes(raw), value
    raise ValueError("网页重定向次数过多")


def parse_source(library, source, progress):
    attrs = source.attrs
    mode = attrs.get("type", "file")
    cache_dir = library.cache / source.id
    cache_dir.mkdir(exist_ok=True)
    if mode == "url":
        import trafilatura
        raw, final_url = fetch_web(attrs["url"])
        extracted = trafilatura.extract(raw, include_tables=True, include_links=False, output_format="txt")
        if not extracted or len(extracted.strip()) < 20:
            raise ValueError("未能提取正文；登录或动态网页请改用粘贴、截图或 PDF")
        digest = library.put_blob(raw)
        attrs = {**attrs, "hash": digest, "mime": "text/plain", "final_url": final_url, "fetched_at": now()}
        blocks = [{"text": p.strip(), "locator": {"block": i + 1, "url": final_url}} for i, p in enumerate(extracted.split("\n\n")) if p.strip()]
        return blocks, attrs
    suffix = Path(attrs.get("filename", "")).suffix.lower()
    path = library.blobs / attrs["hash"]
    if suffix == ".pdf":
        import pypdfium2 as pdfium
        import pdfplumber
        blocks = []
        try:
            pdf = pdfium.PdfDocument(str(path))
        except Exception:
            raise ValueError("PDF 无法打开，可能已损坏或加密，请先解锁再导入") from None
        with pdf, pdfplumber.open(str(path)) as layout:
            if len(pdf) > 300:
                raise ValueError("首版支持最多 300 页 PDF，请拆分后导入")
            for i in range(len(pdf)):
                progress(int(i / max(1, len(pdf)) * 85), f"解析第 {i + 1}/{len(pdf)} 页")
                checkpoint = cache_dir / f"page-{i + 1}.json"
                if checkpoint.exists():
                    blocks.append(json.loads(checkpoint.read_text(encoding="utf-8")))
                    continue
                with closing(pdf[i]) as page:
                    with closing(page.get_textpage()) as textpage:
                        value = textpage.get_text_bounded().strip()
                    boxes = []
                    if len(re.sub(r"\s", "", value)) < 20:
                        bitmap = page.render(scale=1.8)
                        try:
                            value, boxes = ocr_image(bitmap.to_pil())
                        finally:
                            bitmap.close()
                    elif i < len(layout.pages):
                        tables = layout.pages[i].extract_tables()
                        if tables:
                            value += "\n\n表格：\n" + "\n\n".join("\n".join(" | ".join(cell or "" for cell in row) for row in table) for table in tables)
                    block = {"text": value, "locator": {"page": i + 1, "block": i + 1, "ocr": bool(boxes)}}
                    checkpoint.write_text(json.dumps(block, ensure_ascii=False), encoding="utf-8")
                    blocks.append(block)
        return blocks, {**attrs, "pages": len(blocks)}
    if suffix in {".doc", ".docx"}:
        import docx
        from docx.table import Table
        from docx.text.paragraph import Paragraph
        input_path = path
        if suffix == ".doc":
            executable = libreoffice(library.settings())
            if not executable:
                raise ValueError(".doc 导入需要 LibreOffice，请安装后在设置中指定 soffice.exe，然后重试")
            input_path = cache_dir / "input.doc"
            if not input_path.exists():
                shutil.copyfile(path, input_path)
            profile = (cache_dir / "lo-profile").resolve().as_uri()
            try:
                completed = subprocess.run([executable, f"-env:UserInstallation={profile}", "--headless", "--norestore", "--convert-to", "docx", "--outdir", str(cache_dir), str(input_path)], capture_output=True, timeout=90, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            except subprocess.TimeoutExpired:
                raise ValueError("Word 转换超时，请确认文件正常后重试") from None
            input_path = cache_dir / "input.docx"
            if completed.returncode or not input_path.exists():
                raise ValueError("旧版 Word 转换失败，请检查文件是否加密或损坏")
        document = docx.Document(str(input_path))
        blocks = []
        for item in document.iter_inner_content():
            if isinstance(item, Paragraph):
                value = item.text
                heading = item.style.name.startswith("Heading") if item.style else False
            elif isinstance(item, Table):
                value = "\n".join(" | ".join(c.text for c in row.cells) for row in item.rows)
                heading = False
            else:
                continue
            if value.strip():
                blocks.append({"text": value, "heading": heading, "locator": {"block": len(blocks) + 1}})
        images = []
        for rel in document.part.rels.values():
            if "image" in rel.reltype and not rel.is_external:
                images.append({"hash": library.put_blob(rel.target_part.blob), "mime": rel.target_part.content_type})
        return blocks, {**attrs, "images": images}
    if suffix in {".txt", ".md"}:
        raw = path.read_bytes()
        try:
            value = raw.decode("utf-8-sig")
        except UnicodeDecodeError:
            value = raw.decode("gb18030")
        return [{"text": value, "locator": {"block": 1}}], attrs
    with Image.open(path) as image:
        if image.width * image.height > 40_000_000:
            raise ValueError("图片像素过大，请压缩后导入")
        value, boxes = ocr_image(image)
        return [{"text": value, "locator": {"block": 1, "boxes": boxes, "width": image.width, "height": image.height}}], attrs


class Processor:
    def __init__(self, library):
        self.library = library
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        with self.library.Session() as db:
            for job in db.scalars(select(Job).where(Job.status == "running")):
                job.status, job.stage = "queued", "从中断处恢复"
            db.commit()
        self.thread = threading.Thread(target=self.loop, name="manual-ai-worker", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread:
            self.thread.join(timeout=5)

    def update(self, jid, progress, stage):
        if self.stop_event.is_set():
            raise ValueError("应用已停止，任务将在下次启动后恢复")
        with self.library.Session() as db:
            job = db.get(Job, jid)
            if not job or job.status == "cancelled":
                raise ValueError("任务已取消")
            entry = db.get(Entry, job.source_id)
            if not entry or entry.deleted_at:
                raise ValueError("资料已移至回收站")
            job.progress, job.stage, job.updated_at = progress, stage, now()
            db.commit()

    def loop(self):
        while not self.stop_event.wait(.6):
            with self.library.lock:
                with self.library.Session() as db:
                    job = db.scalar(select(Job).where(Job.status == "queued").order_by(Job.created_at))
                    if not job:
                        continue
                    job.status = "running"
                    db.commit()
                    jid, kind, sid = job.id, job.kind, job.source_id
                try:
                    if kind == "index":
                        self.index(jid, sid)
                    elif kind == "identify":
                        from backend.identification import identify_manual
                        identify_manual(self.library, jid, sid, self.update)
                    else:
                        self.process(jid, sid)
                    with self.library.Session() as db:
                        job = db.get(Job, jid)
                        if job.status != "cancelled":
                            job.status, job.progress, job.stage, job.error = "done", 100, "识别与分类完成" if kind == "identify" else "已完成", ""
                            db.commit()
                except Exception as exc:
                    with self.library.Session() as db:
                        job = db.get(Job, jid)
                        if job and job.status != "cancelled":
                            job.status = "queued" if self.stop_event.is_set() else "error"
                            job.error = str(exc)[:300] if isinstance(exc, ValueError) else "文件处理失败，请检查文件格式和组件状态后重试"
                            job.stage = "处理失败"
                            db.commit()

    def process(self, jid, sid):
        with self.library.Session() as db:
            source = db.get(Entry, sid)
            if not source or source.deleted_at:
                raise ValueError("资料不存在或已删除")
            source_revision = source.revision
        if self.thread is not None:
            # PDF/OCR/Office parsing stays outside the HTTP service process.
            output = self.library.cache / (jid + '-' + str(time.time_ns()) + '.json')
            env = {**os.environ, 'MANUAL_AI_HOME': str(self.library.root), 'PYTHONIOENCODING': 'utf-8'}
            process = subprocess.Popen([sys.executable, '-m', 'backend.parse_worker', sid, jid, str(output)], cwd=str(Path(__file__).resolve().parent.parent), env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
            started = time.monotonic()
            while process.poll() is None:
                if self.stop_event.wait(.5) or time.monotonic() - started > 1800:
                    process.terminate()
                    process.wait(timeout=10)
                    raise ValueError('任务中断，已保存的页面可在重试时继续')
                with self.library.Session() as db:
                    job = db.get(Job, jid)
                    if job.status == 'cancelled':
                        process.terminate()
                        process.wait(timeout=10)
                        raise ValueError('任务已取消')
            if process.returncode or not output.exists():
                error_path = Path(str(output) + '.error')
                raise ValueError(error_path.read_text(encoding='utf-8') if error_path.exists() else '文档处理进程意外退出，请重试')
            data = json.loads(output.read_text(encoding='utf-8'))
            blocks, attrs = data['blocks'], data['attrs']
        else:
            blocks, attrs = parse_source(self.library, source, lambda n, s: self.update(jid, n, s))
        if not any(b["text"].strip() for b in blocks):
            raise ValueError("未识别到可搜索文字，原件已保存，可添加自己的笔记")
        self.update(jid, 90, "建立全文索引")
        with self.library.Session() as db:
            source = db.get(Entry, sid)
            manual = db.get(Entry, source.manual_id)
            if source.deleted_at or not manual or manual.deleted_at:
                raise ValueError("资料已删除，停止写入索引")
            if source.revision != source_revision:
                raise ValueError("处理期间资料已修改，请重试以保留最新内容")
            source.attrs = {**attrs, "blocks": blocks, "status": "ready"}
            source.content = "\n\n".join(b["text"] for b in blocks)[:1000]
            source.revision += 1
            source.updated_at = now()
            replace_chunks(db, source, blocks)
            if manual.attrs.get("ai_enabled") and manual.attrs.get("auto_identify"):
                from backend.identification import queue_identification
                queue_identification(db, manual, automatic=True)
            config = self.library.settings()
            if config.get("embedding_base") and config.get("embedding_model") and manual.attrs.get("ai_enabled") and not db.scalar(select(Job).where(Job.source_id == manual.id, Job.kind == "index", Job.status.in_(["queued", "running"]))):
                db.add(Job(source_id=manual.id, kind="index", stage="等待建立 AI 索引"))
            db.commit()
        self.library.invalidate()

    def index(self, jid, manual_id):
        config = self.library.settings()
        space = space_for(config)
        batch_size = embedding_batch_size(config)
        with self.library.Session() as db:
            rows = eligible(db, manual_id, ai=True)
            pending = [(c.id, c.text, c.digest) for c, e in rows if (v := db.get(Vector, (c.id, space))) is None or v.digest != c.digest]
        if not rows:
            raise ValueError("没有已启用 AI 的可索引资料")
        for start in range(0, len(pending), batch_size):
            self.update(jid, int(start / max(1, len(pending)) * 95), f"AI 索引 {start}/{len(pending)} 个片段")
            if space_for(self.library.settings()) != space:
                raise ValueError("向量模型设置已变更，请重新建立 AI 索引")
            with self.library.Session() as db:
                manual = db.get(Entry, manual_id)
                if not manual or manual.deleted_at or not manual.attrs.get("ai_enabled"):
                    raise ValueError("该说明书的 AI 索引已关闭")
                live = {c.id: c for c, _ in eligible(db, manual_id, ai=True)}
                batch = [(cid, text, digest) for cid, text, digest in pending[start:start + batch_size] if cid in live and live[cid].digest == digest]
            if not batch:
                continue
            vectors = embeddings(self.library, [b[1] for b in batch])
            if space_for(self.library.settings()) != space:
                raise ValueError("向量模型设置已变更，请重新建立 AI 索引")
            with self.library.Session() as db:
                live = {c.id: c for c, _ in eligible(db, manual_id, ai=True)}
                for (cid, _, digest), value in zip(batch, vectors):
                    if cid not in live or live[cid].digest != digest:
                        continue
                    vec = np.asarray(value, dtype=np.float32)
                    if vec.ndim != 1 or not len(vec) or not np.isfinite(vec).all() or not np.linalg.norm(vec):
                        raise ValueError("向量 API 返回无效数据")
                    vec = vec / np.linalg.norm(vec)
                    db.merge(Vector(chunk_id=cid, space=space, digest=digest, dimensions=len(vec), value=vec.tobytes()))
                db.commit()
            self.library.invalidate()
