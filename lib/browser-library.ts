import type { Entry, Hit, Job } from './api';
import { backendRequired } from './edition';

const storageKey = 'manual-ai:pages:library:v1';
type Library = { version: 1; entries: Entry[]; jobs: Job[] };
const empty = (): Library => ({ version: 1, entries: [], jobs: [] });
const kinds = ['manual', 'chapter', 'card', 'note', 'category', 'source'];
const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim();
const escapeHTML = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function validate(value: unknown): Library {
  const data = value as Library;
  if (!data || data.version !== 1 || !Array.isArray(data.entries) || data.entries.length > 10000)
    throw new Error('不是有效的浏览器版资料备份。');
  const ids = new Set<string>();
  for (const entry of data.entries) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || !kinds.includes(entry.kind)
      || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.content !== 'string'
      || typeof entry.category !== 'string' || typeof entry.color !== 'string'
      || !Array.isArray(entry.tags) || entry.tags.some(t => typeof t !== 'string')
      || !Number.isInteger(entry.revision) || entry.revision < 1 || !Number.isFinite(entry.position)
      || typeof entry.created_at !== 'string' || typeof entry.updated_at !== 'string'
      || typeof entry.favorite !== 'boolean' || (entry.deleted_at !== null && typeof entry.deleted_at !== 'string')
      || (entry.manual_id !== null && typeof entry.manual_id !== 'string')
      || (entry.parent_id !== null && typeof entry.parent_id !== 'string')
      || !entry.attrs || typeof entry.attrs !== 'object' || Array.isArray(entry.attrs))
      throw new Error('备份结构不完整，当前资料保持不变。');
    ids.add(entry.id);
    entry.attrs.ai_enabled = false;
    if (entry.kind === 'source' && (!Array.isArray(entry.attrs.blocks)
      || entry.attrs.blocks.some((b: any) => typeof b?.text !== 'string' || !b?.locator)))
      throw new Error('备份原文结构无效。');
  }
  for (const entry of data.entries) {
    if (entry.manual_id && !data.entries.some(m => m.id === entry.manual_id && m.kind === 'manual'))
      throw new Error('备份缺少所属说明书。');
    if (entry.parent_id && !data.entries.some(c => c.id === entry.parent_id && c.kind === 'chapter' && c.manual_id === entry.manual_id))
      throw new Error('备份缺少所属章节。');
  }
  return { version: 1, entries: data.entries, jobs: [] };
}

function load(): Library {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return empty();
    const parsed = JSON.parse(raw);
    const data = validate(parsed);
    data.jobs = Array.isArray(parsed.jobs) ? parsed.jobs : [];
    return data;
  } catch { throw new Error('无法读取浏览器资料。请检查浏览器存储权限；不要清除站点数据。'); }
}
function save(data: Library) {
  try { localStorage.setItem(storageKey, JSON.stringify(data)); }
  catch { throw new Error('浏览器空间不足或禁止保存。请先导出备份，再释放空间后重试。'); }
}
function find(data: Library, id: string, deleted = false) {
  const entry = data.entries.find(e => e.id === id && (deleted || !e.deleted_at));
  if (!entry) throw new Error('资料不存在或已移入回收站。');
  return entry;
}
function checkRevision(entry: Entry, revision: number) {
  if (entry.revision !== revision) throw new Error('资料已在其他窗口修改，请刷新后重试。');
}
function touch(entry: Entry) { entry.revision++; entry.updated_at = new Date().toISOString(); }
function make(data: Library, values: Partial<Entry>): Entry {
  const kind = values.kind || 'manual';
  if (!kinds.includes(kind) || !values.title?.trim()) throw new Error('请填写标题。');
  if (!['manual', 'category'].includes(kind)) {
    const manual = find(data, values.manual_id || '');
    if (manual.kind !== 'manual') throw new Error('请选择有效说明书。');
  }
  if (values.parent_id) {
    const parent = find(data, values.parent_id);
    if (parent.kind !== 'chapter' || parent.manual_id !== values.manual_id) throw new Error('请选择所属说明书中的章节。');
  }
  const now = new Date().toISOString();
  const entry: Entry = { id: crypto.randomUUID(), kind, manual_id: values.manual_id || null,
    parent_id: values.parent_id || null, title: values.title.trim(), content: values.content || '',
    category: values.category || '', tags: values.tags || [], color: values.color || 'yellow',
    favorite: !!values.favorite, position: data.entries.length * 10, revision: 1,
    deleted_at: null, created_at: now, updated_at: now, attrs: { ...values.attrs, ai_enabled: false } };
  data.entries.push(entry);
  return entry;
}

export function exportBrowserLibrary() {
  return JSON.stringify({ ...load(), jobs: [] }, null, 2);
}
export function restoreBrowserLibrary(raw: string) {
  if (raw.length > 4000000) throw new Error('备份过大，请使用本地完整版。');
  save(validate(JSON.parse(raw)));
}
export async function browserApi<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  options.signal?.throwIfAborted();
  const data = load(), url = new URL(path, 'https://browser.invalid');
  const route = url.pathname, method = options.method || 'GET';
  const payload = options.body ? JSON.parse(String(options.body)) : {};
  let output: unknown;
  if (route === '/jobs' && method === 'GET') return { items: data.jobs } as T;
  if (route === '/entries' && method === 'GET') {
    const trash = url.searchParams.get('trash') === 'true';
    return { items: data.entries.filter(e => Boolean(e.deleted_at) === trash
      && (!url.searchParams.has('kind') || e.kind === url.searchParams.get('kind'))
      && (!url.searchParams.has('manual_id') || e.manual_id === url.searchParams.get('manual_id'))) } as T;
  }
  if (route === '/entries' && method === 'POST') output = make(data, payload);
  else if (route === '/search' && method === 'POST') {
    const query = String(payload.q || '').toLowerCase().trim();
    const terms = query.split(/\s+/).filter(Boolean);
    const manuals = data.entries.filter(m => m.kind === 'manual' && !m.deleted_at
      && (!payload.manual_id || m.id === payload.manual_id) && (!payload.category || m.category === payload.category)
      && (!payload.tag || m.tags.includes(payload.tag)));
    const hits: Hit[] = [];
    for (const entry of data.entries.filter(e => !e.deleted_at && ['manual', 'note', 'card', 'source'].includes(e.kind)
      && manuals.some(m => m.id === (e.manual_id || e.id)))) {
      const blocks = entry.kind === 'source' ? entry.attrs.blocks : [{ text: entry.title + '\n' + text(entry.content), locator: entry.attrs.locator || {} }];
      for (const [index, block] of blocks.entries()) {
        const haystack = (entry.title + ' ' + block.text).toLowerCase();
        const score = terms.reduce((n: number, term: string) => n + Number(haystack.includes(term)), 0);
        if (score) hits.push({ id: entry.id + ':' + index, entry_id: entry.id, manual_id: entry.manual_id || entry.id,
          title: entry.title, kind: entry.kind, text: block.text, locator: block.locator,
          source_id: entry.kind === 'source' ? entry.id : entry.attrs.source_id || null, score });
      }
    }
    return { items: hits.sort((a, b) => b.score - a.score).slice(0, payload.limit || 30), mode_used: 'keyword',
      warning: payload.mode && payload.mode !== 'keyword' ? '浏览器版使用本地关键词搜索；语义检索请使用本地完整版。' : '' } as T;
  } else if (route === '/chapters/reorder' && method === 'POST') {
    if (!Array.isArray(payload.items) || new Set(payload.items.map((i: any) => i.id)).size !== payload.items.length)
      throw new Error('排序列表无效。');
    const chapters = payload.items.map((item: any) => { const entry = find(data, item.id); checkRevision(entry, item.revision); return entry; });
    if (chapters.some((e: Entry) => e.kind !== 'chapter' || e.manual_id !== chapters[0].manual_id)) throw new Error('只能排序同一本说明书的章节。');
    chapters.forEach((entry: Entry, index: number) => { entry.position = index * 10; touch(entry); });
    output = { ok: true };
  } else if (route === '/chapters/merge' && method === 'POST') {
    const source = find(data, payload.source_id), target = find(data, payload.target_id);
    checkRevision(source, payload.source_revision); checkRevision(target, payload.target_revision);
    if (source.id === target.id || source.kind !== 'chapter' || target.kind !== 'chapter' || source.manual_id !== target.manual_id)
      throw new Error('请选择同一本说明书中的其他章节。');
    data.entries.filter(e => e.parent_id === source.id && !e.deleted_at).forEach(e => { e.parent_id = target.id; touch(e); });
    source.deleted_at = new Date().toISOString(); touch(source); touch(target); output = { ok: true };
  } else if (/^\/sources\/[^/]+\/text$/.test(route) && method === 'PATCH') {
    const source = find(data, route.split('/')[2]); checkRevision(source, payload.revision);
    const block = source.attrs.blocks?.[payload.block];
    if (!block || typeof payload.text !== 'string' || !payload.text.trim()) throw new Error('请选择有效正文段落。');
    source.attrs.blocks[payload.block] = { ...block, original_text: block.original_text ?? block.text, text: payload.text };
    touch(source); output = { ok: true };
  } else if (/^\/entries\/[^/]+(?:\/(trash|restore))?$/.test(route)) {
    const [, , id, action] = route.split('/');
    const entry = find(data, id, action === 'restore');
    if (method === 'GET' && !action) return entry as T;
    if (method === 'PATCH' && !action) {
      checkRevision(entry, payload.revision);
      if (payload.title !== undefined && !String(payload.title).trim()) throw new Error('标题不能为空。');
      if (payload.manual_id) {
        const manual = find(data, payload.manual_id);
        if (manual.kind !== 'manual') throw new Error('目标说明书无效。');
        if (entry.kind === 'chapter') data.entries.filter(e => e.parent_id === entry.id).forEach(e => { e.manual_id = manual.id; touch(e); });
        if (entry.manual_id !== manual.id) entry.parent_id = null;
      }
      const manualId = payload.manual_id || entry.manual_id;
      if (payload.parent_id) { const parent = find(data, payload.parent_id); if (parent.kind !== 'chapter' || parent.manual_id !== manualId) throw new Error('目标章节无效。'); }
      for (const key of ['title', 'content', 'category', 'tags', 'color', 'favorite', 'manual_id', 'parent_id'] as const)
        if (payload[key] !== undefined) (entry as any)[key] = payload[key];
      entry.attrs = { ...entry.attrs, ...payload.attrs, ai_enabled: false }; touch(entry); output = entry;
    } else if (method === 'POST' && action === 'trash') {
      checkRevision(entry, payload.revision);
      const batch = crypto.randomUUID();
      data.entries.filter(e => !e.deleted_at && (e.id === id || (entry.kind === 'manual' && e.manual_id === id) || (entry.kind === 'chapter' && e.parent_id === id)))
        .forEach(e => { e.deleted_at = new Date().toISOString(); e.attrs.trash_batch = batch; touch(e); });
      output = { ok: true };
    } else if (method === 'POST' && action === 'restore') {
      if (entry.manual_id && find(data, entry.manual_id, true).deleted_at) throw new Error('请先恢复所属说明书。');
      if (entry.parent_id && find(data, entry.parent_id, true).deleted_at) throw new Error('请先恢复所属章节。');
      const batch = entry.attrs.trash_batch;
      data.entries.filter(e => e.id === id || (batch && e.attrs.trash_batch === batch)).forEach(e => { e.deleted_at = null; delete e.attrs.trash_batch; touch(e); });
      output = { ok: true };
    } else throw new Error(backendRequired);
  } else if (output === undefined) throw new Error(backendRequired);
  save(data);
  return output as T;
}

export async function importBrowserText(file: File, manualId: string, onProgress: (n: number) => void,
  allowDuplicate: boolean, options?: { newManual: boolean; requestId: string }) {
  if (!/\.(txt|md)$/i.test(file.name)) throw new Error('浏览器版支持 TXT、Markdown 和粘贴文字。PDF、Word、图片及网页链接请使用本地完整版。');
  if (file.size > 1000000) throw new Error('浏览器版单个文本文件最多 1 MB。较大资料请使用本地完整版。');
  onProgress(0);
  const raw = await file.text();
  if (!raw.trim()) throw new Error('文件没有可读取的文字。');
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))), b => b.toString(16).padStart(2, '0')).join('');
  const data = load();
  const previous = data.entries.find(e => e.kind === 'source' && !e.deleted_at && (
    (options?.requestId && e.attrs.request_id === options.requestId)
    || (!allowDuplicate && e.attrs.digest === digest && (options?.newManual || e.manual_id === manualId))));
  if (previous) { onProgress(100); return { source: previous, duplicate: true }; }
  const manual = options?.newManual ? make(data, { kind: 'manual', title: file.name.replace(/\.(txt|md)$/i, '') }) : find(data, manualId);
  if (manual.kind !== 'manual') throw new Error('请选择有效说明书。');
  const source = make(data, { kind: 'source', title: file.name, manual_id: manual.id, content: escapeHTML(raw.slice(0, 1000)),
    attrs: { type: 'file', filename: file.name, mime: 'text/plain', status: 'ready', digest, request_id: options?.requestId,
      blocks: raw.split(/\n\s*\n/).filter(s => s.trim()).map((s, i) => ({ text: s, locator: { block: i + 1 } })) } });
  const job: Job = { id: crypto.randomUUID(), source_id: source.id, title: file.name, kind: 'import', status: 'done', progress: 100, stage: '已保存到此浏览器', error: '' };
  data.jobs = [job, ...data.jobs].slice(0, 100); save(data); onProgress(100);
  return { source, job_id: job.id };
}
