import hashlib
import html
import re
import unicodedata
from uuid import NAMESPACE_URL, uuid5
import jieba
import numpy as np
from sqlalchemy import delete, select, text
from backend.models import Chunk, Entry, Vector

jieba.setLogLevel(40)


def plain(value):
    return html.unescape(re.sub(r"<[^>]*>", " ", value)).strip()


def normalize(value):
    value = unicodedata.normalize("NFKC", value).lower()
    return re.sub(r"\b(gpio|uart|usart|i2c|spi|adc|dac|esp|stm32|pin|io|pwm|usb)\s+(\d+)", r"\1\2", value)


def tokens(value):
    value = normalize(value)
    return " ".join(t for t in jieba.cut_for_search(value) if re.search(r"[\w\u4e00-\u9fff]", t))


def split_text(value, size=900, overlap=120):
    value = value.strip()
    start = 0
    while start < len(value):
        end = min(start + size, len(value))
        if end < len(value):
            cut = max(value.rfind("\n", start + size // 2, end), value.rfind("。", start + size // 2, end))
            if cut >= 0:
                end = cut + 1
        yield value[start:end]
        if end == len(value):
            break
        start = max(start + 1, end - overlap)


def replace_chunks(db, entry, blocks):
    old = db.scalars(select(Chunk).where(Chunk.entry_id == entry.id)).all()
    for chunk in old:
        db.execute(delete(Vector).where(Vector.chunk_id == chunk.id))
    db.execute(text("DELETE FROM search_fts WHERE chunk_id IN (SELECT id FROM chunks WHERE entry_id=:id)"), {"id": entry.id})
    db.execute(delete(Chunk).where(Chunk.entry_id == entry.id))
    n = 0
    for block in blocks:
        for piece in split_text(block["text"]):
            cid = str(uuid5(NAMESPACE_URL, f"{entry.id}:{n}"))
            digest = hashlib.sha256(piece.encode()).hexdigest()
            chunk = Chunk(id=cid, entry_id=entry.id, manual_id=entry.manual_id or entry.id, text=piece, locator=block.get("locator", {}), digest=digest)
            db.add(chunk)
            db.execute(text("INSERT INTO search_fts(chunk_id,title,body) VALUES(:id,:title,:body)"), {"id": cid, "title": tokens(entry.title), "body": tokens(piece)})
            n += 1


def entry_chunks(db, entry):
    if entry.kind in ("manual", "card", "note"):
        replace_chunks(db, entry, [{"text": entry.title + "\n" + plain(entry.content), "locator": entry.attrs.get("locator", {})}])


def eligible(db, manual_id=None, category=None, tag=None, ai=False):
    manuals = {e.id: e for e in db.scalars(select(Entry).where(Entry.kind == "manual", Entry.deleted_at.is_(None)))}
    ids = [m.id for m in manuals.values() if (not manual_id or m.id == manual_id) and (not category or m.category == category) and (not tag or tag in m.tags) and (not ai or m.attrs.get("ai_enabled", False))]
    if not ids:
        return []
    return db.execute(select(Chunk, Entry).join(Entry, Chunk.entry_id == Entry.id).where(Chunk.manual_id.in_(ids), Entry.deleted_at.is_(None))).all()


def rank_keyword(db, q, allowed=None):
    words = list(dict.fromkeys(tokens(q).split()))[:24]
    if not words:
        return []
    expression = " OR ".join('"' + w.replace('"', '""') + '"' for w in words)
    # Apply scope before limiting; unrelated manuals must not crowd out matches.
    sql = "SELECT chunk_id FROM search_fts WHERE search_fts MATCH :q"
    params = {"q": expression}
    if allowed is not None:
        sql += " AND chunk_id IN (SELECT value FROM json_each(:allowed))"
        import json
        params["allowed"] = json.dumps(list(allowed))
    return db.execute(text(sql + " ORDER BY bm25(search_fts,0,3,1) LIMIT 2000"), params).scalars().all()


def vector_rank(library, db, query_vector, space, allowed):
    if library.vector_cache is None or library.vector_cache[0] != space:
        rows = db.execute(select(Vector.chunk_id, Vector.value).join(Chunk, Vector.chunk_id == Chunk.id).where(Vector.space == space, Vector.digest == Chunk.digest, Vector.dimensions == len(query_vector))).all()
        ids = [cid for cid, _ in rows]
        matrix = np.stack([np.frombuffer(value, dtype=np.float32) for _, value in rows]) if rows else np.empty((0, len(query_vector)), dtype=np.float32)
        library.vector_cache = (space, ids, matrix)
    _, ids, matrix = library.vector_cache
    if matrix.shape[1] != len(query_vector):
        raise ValueError("向量模型维度已变化，请重新建立索引")
    if not ids:
        return []
    query = np.asarray(query_vector, dtype=np.float32)
    norm = np.linalg.norm(query)
    if not norm or not np.isfinite(query).all():
        raise ValueError("向量服务返回了无效数据")
    scores = matrix @ (query / norm)
    selected = [(ids[i], float(scores[i])) for i in range(len(ids)) if ids[i] in allowed]
    return [cid for cid, score in sorted(selected, key=lambda x: x[1], reverse=True)[:2000]]


def result(chunk, entry, score):
    return {"id": chunk.id, "entry_id": entry.id, "manual_id": chunk.manual_id, "title": entry.title, "kind": entry.kind, "text": chunk.text, "locator": chunk.locator, "source_id": entry.id if entry.kind == "source" else entry.attrs.get("source_id"), "score": score}
