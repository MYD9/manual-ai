'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ErrorFeedback } from '@/components/tactile';

type Rules = {revision: number; rules: {category: string; keywords: string[]}[]};
type Row = {id: string; category: string; keywords: string};
export default function ClassificationSettings({refresh}: {refresh: () => Promise<void>}) {
  const query = useQuery({queryKey:['classification-rules'], queryFn:() => api<Rules>('/classification-rules'), refetchOnMount:'always'});
  const [rows, setRows] = useState<Row[]>([]), [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  useEffect(() => {
    if (query.data && !dirty) {
      setRows(query.data.rules.map(rule => ({id:crypto.randomUUID(), category:rule.category, keywords:rule.keywords.join('，')})));
      setRevision(query.data.revision);
    }
  }, [query.data, dirty]);
  function change(id:string, field:'category'|'keywords', value:string) {
    setDirty(true); setMessage('');
    setRows(rows => rows.map(row => row.id === id ? {...row, [field]:value} : row));
  }
  async function save() {
    setBusy(true); setError(''); setMessage('');
    try {
      const rules = rows.map(row => ({category:row.category.trim(), keywords:[...new Set(row.keywords.split(/[,，、;；\n]+/).map(s => s.trim()).filter(Boolean))]}));
      if (rules.some(rule => !rule.category || !rule.keywords.length)) throw new Error('请为每条规则填写分类名称和至少一个关键词。');
      if (new Set(rules.map(r => r.category)).size !== rules.length) throw new Error('分类名称重复，请将同一分类的关键词写在一行。');
      const saved = await api<Rules>('/classification-rules', {method:'PUT', body:JSON.stringify({revision,rules})});
      setRevision(saved.revision);
      await query.refetch(); setDirty(false);
      setMessage('分类关键词已保存。新导入的资料按新规则分类；已有说明书可单独调整。');
      await refresh();
    } catch (e) {setError((e as Error).message);} finally {setBusy(false);}
  }
  return <section className="panel" style={{marginBottom:24}} aria-labelledby="classification-heading">
    <h2 id="classification-heading">分类关键词</h2>
    <p className="muted">AI 结合关键词和资料上下文选择分类。没有合适规则时保留待分类；关键词相近时优先更符合内容的分类。</p>
    {!query.isLoading && !rows.length && <p className="notice">还没有规则。可先添加“家用电器：冰箱、洗衣机、空调”等规则；留空时 AI 自行识别分类。</p>}
    {query.isLoading && <p role="status">正在读取分类规则…</p>}
    {query.error && <ErrorFeedback message={query.error.message} onRetry={() => void query.refetch()}/>}
    <div className="classification-rules">
      {rows.map((row, i) => <div className="field-row" key={row.id} style={{alignItems:'end',marginBottom:12}}>
        <label className="field">分类名称 {i+1}<Input value={row.category} maxLength={100} disabled={busy} onChange={e => change(row.id,'category',e.target.value)} placeholder="例如：家用电器"/></label>
        <label className="field" style={{flex:2}}>关键词 {i+1}<Input value={row.keywords} disabled={busy} onChange={e => change(row.id,'keywords',e.target.value)} placeholder="冰箱，洗衣机，空调（逗号分隔）"/></label>
        <Button variant="ghost" aria-label={'移除分类规则 '+(i+1)} disabled={busy} onClick={() => {setRows(rows.filter(r => r.id !== row.id));setDirty(true);setMessage('');}}><Trash2/></Button>
      </div>)}
    </div>
    <div className="toolbar" style={{marginTop:16}}>
      <Button variant="outline" disabled={busy || query.isLoading || !!query.error || rows.length >= 50} onClick={() => {setRows([...rows,{id:crypto.randomUUID(),category:'',keywords:''}]);setDirty(true);setMessage('');}}><Plus/>添加分类规则</Button>
      <Button disabled={busy || !dirty || !!query.error} onClick={() => void save()}>{busy ? '保存中…' : '保存分类关键词'}</Button>
      {dirty && <Button variant="ghost" disabled={busy} onClick={async () => {await query.refetch();setDirty(false);setError('');setMessage('已重新载入保存的规则');}}>放弃修改并重新载入</Button>}
    </div>
    <p className="muted" style={{marginTop:12}}>修改规则不会批量改动现有资料；单本调整也不会改变全局规则。移除规则不会删除已有分类或说明书。</p>
    {error && <ErrorFeedback message={error} busy={busy} onRetry={() => void save()}/>}
    {message && <p role="status" className="notice">{message}</p>}
  </section>;
}
