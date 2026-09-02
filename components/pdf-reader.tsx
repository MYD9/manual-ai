'use client';
import { memo, useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorFeedback } from '@/components/tactile';

// Keep one document open. Only pages near the viewport allocate a canvas.
const Page = memo(function Page({ doc, number, ratio }: { doc: PDFDocumentProxy; number: number; ratio: number }) {
  const sheet = useRef<HTMLElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false), [ready, setReady] = useState(false);
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [aspect, setAspect] = useState(ratio);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root: sheet.current?.closest('.pdf-scroll'), rootMargin: '700px 0px',
    });
    if (sheet.current) observer.observe(sheet.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let cancelled = false, render: RenderTask | undefined;
    const c = canvas.current!;
    setReady(false); setError('');
    void (async () => {
      try {
        const page = await doc.getPage(number);
        if (cancelled) return;
        const natural = page.getViewport({ scale: 1 });
        setAspect(natural.width / natural.height);
        const pixels = Math.min(1600, (sheet.current?.clientWidth || 800) * Math.min(devicePixelRatio || 1, 2));
        const viewport = page.getViewport({ scale: pixels / natural.width });
        c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
        render = page.render({ canvas: c, canvasContext: c.getContext('2d')!, viewport });
        await render.promise;
        if (!cancelled) setReady(true);
      } catch {
        if (!cancelled) setError(`第 ${number} 页加载失败，请重试或下载原件。`);
      }
    })();
    return () => {
      cancelled = true;
      render?.cancel();
      // Release offscreen bitmap memory only after the render has stopped.
      if (render) void render.promise.catch(() => {}).finally(() => { c.width = 0; c.height = 0; });
      else { c.width = 0; c.height = 0; }
    };
  }, [doc, number, near, attempt]);
  return <section ref={sheet} className="pdf-sheet" data-page={number} aria-label={`PDF 第 ${number} 页`} style={{ aspectRatio: aspect }}>
    {near && <canvas key={attempt} ref={canvas} className="pdf-canvas" style={{ opacity: ready ? 1 : 0 }} aria-label={`第 ${number} 页内容；文字可在识别正文中阅读`} />}
    {!ready && !error && <span className="pdf-placeholder">第 {number} 页{near ? ' · 正在绘制…' : ''}</span>}
    {error && <div className="pdf-page-error"><ErrorFeedback message={error} onRetry={() => setAttempt(a => a + 1)} /></div>}
    <span className="pdf-page-number" aria-hidden="true">{number}</span>
  </section>;
});

export default function PDFReader({ url, initialPage }: { url: string; initialPage: number }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [ratio, setRatio] = useState(0.707), [page, setPage] = useState(1), [jump, setJump] = useState('1');
  const [error, setError] = useState(''), [attempt, setAttempt] = useState(0), [progress, setProgress] = useState<number | null>(null);
  const scroll = useRef<HTMLDivElement>(null), frame = useRef(0);
  const total = doc?.numPages || 0;
  useEffect(() => {
    let cancelled = false;
    let loading: ReturnType<typeof import('pdfjs-dist')['getDocument']> | undefined;
    setDoc(null); setError(''); setProgress(null);
    void (async () => {
      try {
        const pdf = await import('pdfjs-dist');
        if (cancelled) return;
        pdf.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        loading = pdf.getDocument({ url });
        loading.onProgress = ({ loaded, total }: { loaded: number; total: number }) => { if (!cancelled && total > 0) setProgress(Math.min(100, Math.round(loaded / total * 100))); };
        const document = await loading.promise;
        const first = await document.getPage(1);
        if (cancelled) return;
        const viewport = first.getViewport({ scale: 1 });
        setRatio(viewport.width / viewport.height); setDoc(document);
      } catch {
        if (!cancelled) setError('PDF 加载失败。请重试，或通过“下载原件”查看。');
      }
    })();
    return () => { cancelled = true; if (loading) void loading.destroy(); };
  }, [url, attempt]);
  function go(value: number) {
    if (!total || !Number.isFinite(value)) return;
    const target = Math.max(1, Math.min(total, Math.trunc(value)));
    const box = scroll.current?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (box && scroll.current) scroll.current.scrollTo({ top: box.offsetTop - 12, behavior: 'instant' });
    setPage(target); setJump(String(target));
  }
  useEffect(() => {
    if (!doc) return;
    const id = requestAnimationFrame(() => go(initialPage));
    return () => cancelAnimationFrame(id);
  }, [doc, initialPage]); // Navigation does not reload the PDF document.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  return <div className="pdf-reader">
    <div className="toolbar pdf-toolbar" aria-label="PDF 阅读控制">
      <Button variant="outline" disabled={!total || page <= 1} onClick={() => go(page - 1)} aria-label="上一页"><ChevronLeft /></Button>
      <span className="muted">第 {page} / {total || '…'} 页</span>
      <Button variant="outline" disabled={!total || page >= total} onClick={() => go(page + 1)} aria-label="下一页"><ChevronRight /></Button>
      <form className="pdf-jump" onSubmit={e => { e.preventDefault(); go(Number(jump)); }}>
        <input aria-label="跳转页码" inputMode="numeric" type="number" min={1} max={total || 1} value={jump} disabled={!total} onChange={e => setJump(e.target.value)} />
        <Button variant="ghost" type="submit" disabled={!total || !jump.trim()}>跳转</Button>
      </form>
      <span className="muted pdf-hint">向下滚动连续阅读</span>
    </div>
    {error ? <ErrorFeedback message={error} onRetry={() => setAttempt(a => a + 1)} /> : !doc ? <div className="pdf-loading" role="status">正在加载 PDF{progress !== null ? ` · ${progress}%` : '…'}{progress !== null && <progress value={progress} max={100} aria-label="PDF 下载进度" />}</div> :
      <div className="pdf-scroll" ref={scroll} tabIndex={0} aria-label="PDF 连续阅读区域" onScroll={() => {
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => {
          const root = scroll.current;
          if (!root) return;
          const boxes = root.querySelectorAll<HTMLElement>('[data-page]');
          let current = 1;
          for (const box of boxes) { if (box.offsetTop <= root.scrollTop + root.clientHeight * 0.35) current = Number(box.dataset.page); else break; }
          setPage(current); setJump(String(current));
        });
      }}>
        {Array.from({ length: total }, (_, i) => <Page key={`${attempt}-${i}`} doc={doc} number={i + 1} ratio={ratio} />)}
      </div>}
  </div>;
}
