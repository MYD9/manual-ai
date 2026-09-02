'use client';
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { post, type Entry, type Job } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ErrorFeedback } from '@/components/tactile';

export default function MetadataAssistant({manual,jobs,refresh,onEdit}: {manual:Entry; jobs:Job[]; refresh:()=>Promise<void>; onEdit:()=>void}) {
  const [open,setOpen] = useState(false), [instruction,setInstruction] = useState(''), [scope,setScope] = useState<'category'|'all'>('category');
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const job = jobs.find(j => j.kind === 'identify' && j.source_id === manual.id);
  const pending = !!job && ['queued','running'].includes(job.status);
  async function submit() {
    setBusy(true);setError('');
    try {
      await post('/manuals/'+manual.id+'/identify',{revision:manual.revision,instruction,scope});
      setOpen(false);setInstruction('');await refresh();
    } catch (e) {setError((e as Error).message);await refresh();} finally {setBusy(false);}
  }
  return <section className="notice" style={{marginTop:16}} aria-label="AI 信息识别与分类">
    <div className="card-top">
      <div>
        <strong>{pending ? 'AI 正在整理这本说明书' : manual.attrs.identification ? 'AI 已识别信息与分类' : 'AI 信息识别与分类'}</strong>
        <p className="muted" role="status">{pending ? job.stage : manual.attrs.identification?.reason || '自动识别品牌、型号、标签与分类，之后仍可手动编辑。'}</p>
      </div>
      <Button variant="outline" disabled={pending} onClick={() => {setOpen(true);setError('');}}><Sparkles/>调整分类与信息</Button>
    </div>
    {manual.attrs.identification?.skipped?.length > 0 && <p className="muted">已保留你手动修改的信息。</p>}
    {job && ['error','cancelled'].includes(job.status) && <ErrorFeedback message={job.error || 'AI 识别已取消，资料已保留。'} busy={busy} onRetry={async () => {setBusy(true);try {await post('/jobs/'+job.id+'/retry');await refresh();} catch(e) {setError((e as Error).message);} finally {setBusy(false);}}}/>}
    {error && !open && <p role="alert" className="error">{error}</p>}
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <DialogTitle>调整这本说明书</DialogTitle>
        <DialogDescription>告诉 AI 哪里需要调整。本次要求只影响“{manual.title}”，不会修改分类关键词规则。</DialogDescription>
        {!manual.attrs.ai_enabled && <div className="notice">请先在编辑中开启这本说明书的云端 AI。<Button variant="ghost" onClick={() => {setOpen(false);onEdit();}}>编辑说明书</Button></div>}
        <label className="field">调整范围<select value={scope} disabled={busy} onChange={e => setScope(e.target.value as 'category'|'all')}><option value="category">只调整分类</option><option value="all">重新识别信息与分类（保留手动修改）</option></select></label>
        <label className="field">调整要求（可选）<textarea value={instruction} disabled={busy} maxLength={1000} rows={4} onChange={e => setInstruction(e.target.value)} placeholder="例如：这是开发板，归到嵌入式开发，不要放在家用电器。留空则按当前关键词重新识别。"/></label>
        <p className="muted">“只调整分类”将更新当前分类；重新识别其他信息会保留你手动修改过的字段。提取的资料正文会发送至设置中的对话服务。</p>
        {error && <ErrorFeedback message={error} busy={busy} onRetry={() => void submit()}/>}
        <div className="toolbar"><Button disabled={busy || pending || !manual.attrs.ai_enabled} onClick={() => void submit()}>{busy ? '正在提交…' : '让 AI 调整'}</Button><Button variant="ghost" onClick={() => setOpen(false)}>关闭</Button></div>
      </DialogContent>
    </Dialog>
  </section>;
}
