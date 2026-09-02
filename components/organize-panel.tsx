'use client';
import { useEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { ErrorFeedback, LoadingCards } from '@/components/tactile';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Entry, api, post } from '@/lib/api';

type DraftCard = { chapter: string; title: string; content: string; reference: string; source_title: string; locator: Record<string, any>; included?: boolean };
type Draft = { revision: number; snapshot: string; chapters: string[]; cards: DraftCard[]; category: string; brand: string; model: string; tags: string[]; summary: string; coverage: string; update_metadata: boolean };
export default function OrganizePanel({ manual, onClose, onDone }: { manual: Entry; onClose: () => void; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft | null>(null), [busy, setBusy] = useState<'' | 'generate' | 'apply'>(''), [error, setError] = useState('');
  const [instruction, setInstruction] = useState(''), [lastAction, setLastAction] = useState<'generate' | 'apply'>('generate');
  const abort = useRef<AbortController | null>(null), pending = useRef(false);
  useEffect(() => () => abort.current?.abort(), []);
  async function generate() {
    if (pending.current) return;
    pending.current = true; setBusy('generate'); setError(''); setLastAction('generate');
    abort.current = new AbortController();
    try {
      const value = await api<Draft>('/manuals/' + manual.id + '/organize', { method: 'POST', body: JSON.stringify({ instruction }), signal: abort.current.signal });
      setDraft({ ...value, cards: value.cards.map(c => ({ ...c, included: true })) });
    } catch (e) { if ((e as Error).name !== 'AbortError') setError((e as Error).message); }
    finally { pending.current = false; setBusy(''); }
  }
  async function apply() {
    if (!draft || pending.current) return;
    pending.current = true; setBusy('apply'); setError(''); setLastAction('apply');
    try {
      await post('/manuals/' + manual.id + '/organize/apply', { ...draft, cards: draft.cards.filter(c => c.included), chapters: draft.chapters.map(s => s.trim()).filter(Boolean) });
      onDone();
    } catch (e) { const message = (e as Error).message; setError(message); if (message.includes('重新生成')) setLastAction('generate'); }
    finally { pending.current = false; setBusy(''); }
  }
  function cardChange(index: number, change: Partial<DraftCard>) {
    setDraft(d => d && ({ ...d, cards: d.cards.map((c, i) => i === index ? { ...c, ...change } : c) }));
  }
  const selected = draft?.cards.filter(c => c.included) || [];
  const valid = selected.length > 0 && selected.every(c => c.title.trim() && c.content.trim() && draft?.chapters.includes(c.chapter)) && draft?.chapters.every(t => t.trim());
  return <Dialog open onOpenChange={o => { if (!o && busy !== 'apply') { abort.current?.abort(); onClose(); } }}>
    <DialogContent className="dialog-wide organize-panel" showCloseButton={busy !== 'apply'}>
      <DialogTitle>AI 生成章节与卡片</DialogTitle>
      <DialogDescription>阅读「{manual.title}」的原文，生成可编辑初稿。采纳后加入资料库；已有章节会复用，已有卡片和笔记会保留。</DialogDescription>
      <label className="field">本次整理要求（可选）<textarea rows={2} maxLength={1000} value={instruction} disabled={!!busy} onChange={e => setInstruction(e.target.value)} placeholder="例如：按接线、参数配置、常见故障整理，每张卡片说明一个操作。" /></label>
      {!manual.attrs.ai_enabled && <p className="notice">请先关闭此窗口，在“编辑”中开启这本说明书的云端 AI。</p>}
      {error && <ErrorFeedback message={error} busy={!!busy} onRetry={lastAction === 'apply' ? apply : generate} />}
      {busy === 'generate' && <LoadingCards label="正在阅读原文并组织章节、卡片与出处；完成后可预览" />}
      {draft && <fieldset disabled={!!busy} className="draft-fields">
        <p className="notice">{draft.coverage} 已选 {selected.length} 张卡片。可取消不需要的卡片，之后仍可在资料库中编辑。</p>
        {draft.chapters.map((chapter, ci) => <section key={ci} className="draft-chapter">
          <label className="field">章节 {ci + 1}<input value={chapter} maxLength={200} onChange={e => {
            const title = e.target.value;
            setDraft({ ...draft, chapters: draft.chapters.map((t, i) => i === ci ? title : t), cards: draft.cards.map(c => c.chapter === chapter ? { ...c, chapter: title } : c) });
          }} /></label>
          {draft.cards.map((card, index) => card.chapter !== chapter ? null : <article key={index} className={'draft-card' + (card.included ? '' : ' excluded')}>
            <label className="checkbox-line"><input type="checkbox" checked={!!card.included} onChange={e => cardChange(index, { included: e.target.checked })} />加入卡片 {index + 1}</label>
            <label className="field">卡片标题<input value={card.title} maxLength={200} disabled={!card.included} onChange={e => cardChange(index, { title: e.target.value })} /></label>
            <label className="field">卡片正文<textarea rows={5} value={card.content} maxLength={6000} disabled={!card.included} onChange={e => cardChange(index, { content: e.target.value })} /></label>
            <p className="muted">出处：{card.source_title}{card.locator.page ? ` · 第 ${card.locator.page} 页` : card.locator.block ? ` · 段落 ${card.locator.block}` : ''} · 加入后可打开原文</p>
          </article>)}
        </section>)}
        <label className="checkbox-line"><input type="checkbox" checked={draft.update_metadata} onChange={e => setDraft({ ...draft, update_metadata: e.target.checked })} />同时更新说明书摘要与信息</label>
        {draft.update_metadata && <>
          <div className="field-row">{(['category', 'brand', 'model'] as const).map((key, i) => <label className="field" key={key}>{['分类', '品牌', '型号'][i]}<input maxLength={100} value={draft[key]} onChange={e => setDraft({ ...draft, [key]: e.target.value })} /></label>)}</div>
          <label className="field">标签（逗号分隔）<input value={draft.tags.join(',')} onChange={e => setDraft({ ...draft, tags: e.target.value.split(/[,，]/) })} /></label>
          <label className="field">说明书摘要<textarea rows={4} maxLength={4000} value={draft.summary} onChange={e => setDraft({ ...draft, summary: e.target.value })} /></label>
        </>}
      </fieldset>}
      <div className="toolbar draft-actions">
        {draft && <Button disabled={!!busy || !valid} onClick={apply}>{busy === 'apply' ? '正在加入…' : `加入 ${selected.length} 张卡片`}</Button>}
        <Button variant={draft ? 'outline' : 'default'} disabled={!!busy || !manual.attrs.ai_enabled} onClick={generate}><Sparkles />{busy === 'generate' ? '正在生成初稿…' : draft ? '重新生成' : '生成章节与卡片初稿'}</Button>
        <Button variant="ghost" disabled={busy === 'apply'} onClick={() => { abort.current?.abort(); onClose(); }}>{busy === 'generate' ? '取消' : '关闭'}</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
