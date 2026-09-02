import { beforeEach, expect, it, vi } from 'vitest';
import { browserApi, exportBrowserLibrary, restoreBrowserLibrary, importBrowserText } from './browser-library';

let saved = new Map<string, string>();
beforeEach(() => {
  saved = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value) });
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Browser edition must not send API requests'); }));
});
const create = (value: Record<string, unknown>) => browserApi('/entries', { method: 'POST', body: JSON.stringify(value) });
const post = (path: string, value: unknown) => browserApi(path, { method: 'POST', body: JSON.stringify(value) });

it('starts empty and edits/searches only this browser, with revision protection', async () => {
  expect((await browserApi('/entries')).items).toEqual([]);
  const manual = await create({ title: '虚构设备' });
  const note = await create({ kind: 'note', manual_id: manual.id, title: '供电', content: '<p>示例电压 5V</p>' });
  const result = await post('/search', { q: '5V', mode: 'hybrid', manual_id: manual.id });
  expect(result.mode_used).toBe('keyword');
  expect(result.warning).toContain('浏览器版');
  expect(result.items[0].entry_id).toBe(note.id);
  await browserApi('/entries/' + note.id, { method: 'PATCH', body: JSON.stringify({ revision: 1, content: '3.3V' }) });
  await expect(browserApi('/entries/' + note.id, { method: 'PATCH', body: JSON.stringify({ revision: 1, title: '旧内容' }) })).rejects.toThrow('其他窗口');
  expect((await post('/search', { q: '5V' })).items).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

it('restores a manual without restoring previously deleted notes', async () => {
  const manual = await create({ title: '虚构说明书' });
  const old = await create({ kind: 'note', manual_id: manual.id, title: '单独删除' });
  const keep = await create({ kind: 'note', manual_id: manual.id, title: '随说明书恢复' });
  await post('/entries/' + old.id + '/trash', { revision: 1 });
  await post('/entries/' + manual.id + '/trash', { revision: 1 });
  await expect(post('/entries/' + keep.id + '/restore', {})).rejects.toThrow('所属说明书');
  await post('/entries/' + manual.id + '/restore', {});
  expect((await browserApi('/entries')).items.map((e: any) => e.id)).toEqual([manual.id, keep.id]);
});

it('reorders atomically and moves chapter cards with the chapter', async () => {
  const manual = await create({ title: '甲' }), other = await create({ title: '乙' });
  const a = await create({ kind: 'chapter', title: 'A', manual_id: manual.id });
  const b = await create({ kind: 'chapter', title: 'B', manual_id: manual.id });
  const card = await create({ kind: 'card', title: '卡片', manual_id: manual.id, parent_id: a.id });
  await expect(post('/chapters/reorder', { items: [{ id: a.id, revision: 1 }, { id: b.id, revision: 2 }] })).rejects.toThrow();
  expect((await browserApi('/entries/' + a.id)).revision).toBe(1);
  await post('/chapters/reorder', { items: [{ id: b.id, revision: 1 }, { id: a.id, revision: 1 }] });
  expect((await browserApi('/entries/' + b.id)).position).toBeLessThan((await browserApi('/entries/' + a.id)).position);
  await browserApi('/entries/' + a.id, { method: 'PATCH', body: JSON.stringify({ revision: 2, manual_id: other.id }) });
  expect((await browserApi('/entries/' + card.id)).manual_id).toBe(other.id);
});

it('imports text with real completion, detects duplicate requests, and preserves editable sources', async () => {
  const file = new File(['第一段虚构说明。\n\n第二段供电 5V。'], 'example.txt', { type: 'text/plain' });
  const progress: number[] = [];
  const imported = await importBrowserText(file, '', n => progress.push(n), false, { newManual: true, requestId: 'request-1' });
  expect(progress).toEqual([0, 100]);
  expect(imported.job_id).toBeTruthy();
  expect((await browserApi('/jobs')).items[0].status).toBe('done');
  const again = await importBrowserText(file, '', () => {}, false, { newManual: true, requestId: 'request-1' });
  expect(again.duplicate).toBe(true);
  expect((await browserApi('/entries?kind=manual')).items).toHaveLength(1);
  await browserApi('/sources/' + imported.source.id + '/text', { method: 'PATCH', body: JSON.stringify({ revision: 1, block: 1, text: '供电已校正为 3.3V' }) });
  expect((await post('/search', { q: '3.3V' })).items[0].source_id).toBe(imported.source.id);
  expect(fetch).not.toHaveBeenCalled();
});

it('rejects backend-only operations and unsupported files without sending data', async () => {
  await expect(post('/manuals/example/index', {})).rejects.toThrow('本地完整版');
  await expect(post('/imports/url', { url: 'https://example.com' })).rejects.toThrow('本地完整版');
  await expect(importBrowserText(new File(['not-pdf'], 'example.pdf'), '', () => {}, false)).rejects.toThrow('本地完整版');
  expect(fetch).not.toHaveBeenCalled();
});

it('round-trips backups, rejects invalid replacements, and keeps saved data on quota failure', async () => {
  const manual = await create({ title: '保留资料' });
  const backup = exportBrowserLibrary();
  await create({ title: '之后新增' });
  restoreBrowserLibrary(backup);
  expect((await browserApi('/entries')).items.map((e: any) => e.id)).toEqual([manual.id]);
  expect(() => restoreBrowserLibrary('{"version":1,"entries":[{}]}')).toThrow();
  expect(exportBrowserLibrary()).toBe(backup);
  vi.stubGlobal('localStorage', { getItem: (key: string) => saved.get(key) ?? null, setItem: () => { throw new Error('quota'); } });
  await expect(create({ title: '不能保存' })).rejects.toThrow('空间不足');
  expect((await browserApi('/entries')).items).toHaveLength(1);
});
