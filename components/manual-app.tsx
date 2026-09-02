'use client';
import { browserEdition } from '@/lib/edition';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import {
  BookOpen,
  Search,
  Plus,
  Star,
  FolderOpen,
  Upload,
  Settings,
  Sparkles,
  StickyNote,
  ArrowUpRight,
  Trash2,
  Menu,
  ArrowLeft,
  FileText,
  ChevronUp,
  ChevronDown,
  Edit3,
  RotateCcw,
  GripVertical,
  Check,
  RefreshCw,
  LoaderCircle,
  X,
  LayoutGrid,
  List,
  MoreHorizontal,
  ArrowRight,
} from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import {
  TactileProvider,
  ReflowList,
  Progress,
  LoadingCards,
  ErrorFeedback,
  useHaptic,
} from '@/components/tactile';
import ChapterList from '@/components/chapter-list';
import MetadataAssistant from '@/components/metadata-assistant';
import { WorkspaceNavigation } from '@/components/workspace-navigation';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, post, patch, strip, date, Entry, Hit, Job } from '@/lib/api';
import { SafeHTML } from '@/components/rich-editor';
import SourceReader from '@/components/source-reader';
import EditDialog from '@/components/edit-dialog';
import ImportPanel from '@/components/import-panel';
import SettingsPanel from '@/components/settings-panel';
import OrganizePanel from '@/components/organize-panel';
import AIPanel from '@/components/ai-panel';
import {
  ActionToast,
  FavoriteButton,
  type Notice,
} from '@/components/interaction-feedback';

const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } },
});
type View =
  | 'library'
  | 'favorites'
  | 'imports'
  | 'settings'
  | 'trash'
  | 'search';
export type EditSpec = {
  entry?: Entry;
  kind: string;
  manual_id?: string;
  parent_id?: string;
  content?: string;
  attrs?: Record<string, any>;
};
export default function ManualApp() {
  return (
    <QueryClientProvider client={client}>
      <TactileProvider>
        <Workspace />
      </TactileProvider>
    </QueryClientProvider>
  );
}
function Workspace() {
  const qc = useQueryClient();
  const pulse = useHaptic();
  const [importRequest, setImportRequest] = useState(0);
  const [organize, setOrganize] = useState<Entry | null>(null);
  const [libraryLayout, setLibraryLayout] = useState<'grid' | 'list'>('grid');
  const [view, setView] = useState<View>('library'),
    [manualId, setManualId] = useState<string | null>(null),
    [category, setCategory] = useState(''),
    [tag, setTag] = useState(''),
    [recent, setRecent] = useState(false),
    [mobile, setMobile] = useState(false);
  const [edit, setEdit] = useState<EditSpec | null>(null),
    [notice, setNotice] = useState<Notice | null>(null),
    [q, setQ] = useState(''),
    [searchMode, setSearchMode] = useState(browserEdition ? 'keyword' : 'hybrid'),
    [searchManual, setSearchManual] = useState(''),
    [hits, setHits] = useState<Hit[]>([]),
    [searchWarning, setSearchWarning] = useState(''),
    [searching, setSearching] = useState(false);
  const [reader, setReader] = useState<{ id: string; locator?: any } | null>(
      null,
    ),
    [ai, setAi] = useState<{ manualId?: string; purpose?: string } | null>(
      null,
    ),
    [confirm, setConfirm] = useState<{
      message: string;
      run: () => Promise<void>;
    } | null>(null),
    [actionBusy, setActionBusy] = useState(false),
    [chapter, setChapter] = useState(''),
    [detailTab, setDetailTab] = useState('content');
  const searchRef = useRef<HTMLInputElement>(null);
  const noticeId = useRef(0);
  const [searchFocus, setSearchFocus] = useState(0);
  const [searchError, setSearchError] = useState(''),
    [submittedQuery, setSubmittedQuery] = useState(''),
    [usedMode, setUsedMode] = useState('keyword'),
    [resolvedQuery, setResolvedQuery] = useState('');
  const searchAbort = useRef<AbortController | null>(null);
  const searchGeneration = useRef(0);
  const lastSearch = useRef<Record<string, unknown> | null>(null);
  useEffect(() => () => searchAbort.current?.abort(), []);
  function clearSearch() {
    searchGeneration.current++;
    searchAbort.current?.abort();
    setSearching(false);
    setQ('');
    setHits([]);
    setSubmittedQuery('');
    setResolvedQuery('');
    setSearchWarning('');
    setSearchError('');
    searchRef.current?.focus();
  }
  const dismissNotice = useCallback(() => setNotice(null), []);
  const entriesQ = useQuery({
    queryKey: ['entries'],
    queryFn: () => api<{ items: Entry[] }>('/entries'),
    refetchInterval: view === 'imports' ? 4000 : false,
  });
  const trashQ = useQuery({
    queryKey: ['trash'],
    queryFn: () => api<{ items: Entry[] }>('/entries?trash=true'),
    enabled: view === 'trash',
  });
  const jobsQ = useQuery({
    queryKey: ['jobs'],
    queryFn: () => api<{ items: Job[] }>('/jobs'),
    refetchInterval: 4000,
  });
  const entries = entriesQ.data?.items || [],
    manuals = entries.filter((e) => e.kind === 'manual'),
    manual = manuals.find((e) => e.id === manualId),
    children = entries.filter((e) => e.manual_id === manualId),
    chapters = children
      .filter((e) => e.kind === 'chapter')
      .sort((a, b) => a.position - b.position);
  const jobs = jobsQ.data?.items || [],
    pendingJobs = jobs.filter((j) =>
      ['queued', 'running'].includes(j.status),
    ).length;
  const jobStatusKey = jobs.map(j => j.id + ':' + j.status).join('|');
  useEffect(() => { if (jobStatusKey) void qc.invalidateQueries({queryKey:['entries']}); }, [jobStatusKey, qc]);
  const categoryNames = Array.from(
    new Set([
      ...entries.filter((e) => e.kind === 'category').map((e) => e.title),
      ...manuals.map((e) => e.category).filter(Boolean),
    ]),
  );
  const tags = Array.from(new Set(manuals.flatMap((m) => m.tags))).slice(0, 18);
  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['entries'] }),
      qc.invalidateQueries({ queryKey: ['trash'] }),
      qc.invalidateQueries({ queryKey: ['jobs'] }),
      qc.invalidateQueries({ queryKey: ['source'] }),
    ]);
  }, [qc]);
  const notify = useCallback(
    (text: string, options: Omit<Notice, 'id' | 'text'> = {}) => {
      setNotice({ text, id: ++noticeId.current, ...options });
      pulse(options.tone === 'error' ? 'error' : 'success');
    },
    [pulse],
  );
  const act = async (fn: () => Promise<any>, message = '已保存') => {
    try {
      await fn();
      await refresh();
      notify(message);
    } catch (e) {
      notify((e as Error).message, { tone: 'error' });
    }
  };
  function requestSearch() {
    go('search');
    setSearchFocus((value) => value + 1);
  }
  useEffect(() => {
    if (searchFocus) searchRef.current?.focus();
  }, [searchFocus]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobile(false);
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!edit && !reader && !organize && !confirm && !ai) requestSearch();
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [edit, reader, organize, confirm, ai]);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get('manual')) setManualId(p.get('manual'));
  }, []);
  function go(next: View, mid: string | null = null) {
    setView(next);
    setManualId(mid);
    setChapter('');
    setMobile(false);
    setDetailTab('content');
    window.history.replaceState(null, '', mid ? window.location.pathname + '?manual=' + encodeURIComponent(mid) : window.location.pathname);
  }
  function startNewManual() {
    setImportRequest(value => value + 1);
    setSearchManual('');
    go('imports');
  }
  function openManual(mid: string) {
    go('library', mid);
  }
  function newEntry(kind: string) {
    setEdit({
      kind,
      manual_id: manualId || undefined,
      parent_id: chapter || undefined,
    });
  }
  async function runSearch(
    e?: React.FormEvent,
    retryPayload?: Record<string, unknown>,
  ) {
    e?.preventDefault();
    const payload = retryPayload || {
      q: q.trim(),
      mode: searchMode,
      manual_id: searchManual || undefined,
      category: category || undefined,
      tag: tag || undefined,
    };
    if (!String(payload.q || '').trim()) return;
    const generation = ++searchGeneration.current;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    lastSearch.current = payload;
    setSubmittedQuery(String(payload.q));
    setSearching(true);
    setSearchError('');
    setSearchWarning('');
    setView('search');
    setManualId(null);
    try {
      const data = await api('/search', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (generation !== searchGeneration.current) return;
      setHits(data.items);
      setResolvedQuery(String(payload.q));
      setSearchWarning(data.warning || '');
      setUsedMode(data.mode_used || String(payload.mode));
    } catch (error) {
      if (
        generation === searchGeneration.current &&
        !controller.signal.aborted
      ) {
        setSearchError((error as Error).message);
        pulse('error');
      }
    } finally {
      if (generation === searchGeneration.current) setSearching(false);
    }
  }
  function remove(entry: Entry) {
    setConfirm({
      message:
        '将「' + entry.title + '」移至回收站？原始文件会保留，可以随时恢复。',
      run: async () => {
        await post('/entries/' + entry.id + '/trash', {
          revision: entry.revision,
        });
        if (entry.id === manualId) go('library');
        await refresh();
        notify('已移至回收站', {
          undo: async () => {
            await act(
              () => post('/entries/' + entry.id + '/restore'),
              '已撤销，资料已恢复',
            );
          },
        });
      },
    });
  }
  function openCardSource(entry: Entry) {
    if (entry.attrs.source_id) setReader({ id: entry.attrs.source_id, locator: entry.attrs.locator });
    else if (entry.attrs.reference_entry_id) openHit({ id: entry.attrs.source_chunk, entry_id: entry.attrs.reference_entry_id, manual_id: entry.attrs.reference_manual_id || entry.manual_id!, title: '', kind: entry.attrs.reference_kind, text: '', locator: {}, source_id: null, score: 0 });
  }
  function openHit(hit: Hit) {
    if (hit.source_id) setReader({ id: hit.source_id, locator: hit.locator });
    else {
      openManual(hit.manual_id);
      setDetailTab(hit.kind === 'note' ? 'notes' : 'content');
      setChapter('');
      setTimeout(
        () =>
          document
            .getElementById('entry-' + hit.entry_id)
            ?.scrollIntoView({ block: 'center' }),
        100,
      );
    }
  }
  useEffect(() => {
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: any) => {
      try {
        void Promise.resolve(
          context.registerTool(tool, { signal: lifecycle.signal }),
        ).catch(() => {});
      } catch {}
    };
    register({
      name: 'search_manual_library',
      description:
        'Search the local library and display results without changing saved data.',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 1 } },
        required: ['query'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input: any) => {
        if (typeof input.query !== 'string' || !input.query.trim())
          throw new Error('query is required');
        const generation = ++searchGeneration.current;
        searchAbort.current?.abort();
        const data = await post('/search', { q: input.query, mode: 'keyword' });
        if (generation !== searchGeneration.current)
          return { count: 0, items: [] };
        setSubmittedQuery(input.query);
        setResolvedQuery(input.query);
        setUsedMode('keyword');
        setSearchError('');
        setSearching(false);
        setQ(input.query);
        setView('search');
        setManualId(null);
        setHits(data.items);
        setSearchWarning(data.warning);
        return {
          count: data.items.length,
          items: data.items.map((h: Hit) => ({ title: h.title, text: h.text })),
        };
      },
    });
    register({
      name: 'start_manual_creation',
      description: 'Open import-first manual creation without saving a record.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute: async () => {
        startNewManual();
        return { opened: true };
      },
    });
    return () => lifecycle.abort();
  }, []);
  const filteredManuals = manuals
    .filter(
      (m) =>
        (!category || m.category === category) &&
        (!tag || m.tags.includes(tag)),
    )
    .sort((a, b) =>
      recent
        ? b.updated_at.localeCompare(a.updated_at)
        : Number(b.favorite) - Number(a.favorite) ||
          b.updated_at.localeCompare(a.updated_at),
    );
  const searchEdited =
    q.trim() !== submittedQuery ||
    searchMode !== lastSearch.current?.mode ||
    searchManual !== (lastSearch.current?.manual_id || '') ||
    category !== (lastSearch.current?.category || '') ||
    tag !== (lastSearch.current?.tag || '');
  return (
    <div className="shell">
      <WorkspaceNavigation open={mobile} onOpenChange={setMobile}>
        <div className="brand">
          <span className="brand-icon">
            <BookOpen size={22} />
          </span>
          <span>
            Manual<span className="brand-ai">AI</span>
          </span>
        </div>
        <div className="workspace-label">
          我的个人空间 <span>{browserEdition ? "BROWSER" : "LOCAL"}</span>
        </div>
        <nav>
          <button
            className={'nav-item ' + (view === 'library' ? 'active' : '')}
            onClick={() => {
              setCategory('');
              setTag('');
              go('library');
            }}
          >
            <FolderOpen />
            全部说明书<span className="nav-count">{manuals.length}</span>
          </button>
          <button
            className={'nav-item ' + (view === 'search' ? 'active' : '')}
            onClick={requestSearch}
          >
            <Search />搜索资料<kbd className="nav-shortcut">Ctrl K</kbd>
          </button>
          <button
            className={'nav-item ' + (view === 'favorites' ? 'active' : '')}
            onClick={() => go('favorites')}
          >
            <Star />
            收藏速查
          </button>
          <button
            className={'nav-item ' + (view === 'imports' ? 'active' : '')}
            onClick={() => go('imports')}
          >
            <Upload />
            导入中心
            {pendingJobs > 0 && (
              <span className="nav-count">{pendingJobs}</span>
            )}
          </button>
        </nav>
        <div className="side-heading">
          我的分类
          <button
            aria-label="新增分类"
            className="icon-btn"
            onClick={() => setEdit({ kind: 'category' })}
          >
            <Plus />
          </button>
        </div>
        {categoryNames.length ? (
          categoryNames.map((c) => {
            const item = entries.find(
              (e) => e.kind === 'category' && e.title === c,
            );
            return (
              <div key={c} className="toolbar category-row" style={{ gap: 0 }}>
                <button
                  style={{ flex: 1, minWidth: 0 }}
                  className={'nav-item ' + (category === c ? 'active' : '')}
                  onClick={() => {
                    setCategory(c);
                    setTag('');
                    go('library');
                  }}
                >
                  <span style={{ fontSize: 11 }}>●</span>
                  {c}
                  <span className="nav-count">
                    {manuals.filter((m) => m.category === c).length}
                  </span>
                </button>
                {item && (
                  <>
                    <button
                      className="icon-btn"
                      aria-label={'编辑分类 ' + c}
                      onClick={() => setEdit({ kind: 'category', entry: item })}
                    >
                      <Edit3 size={12} />
                    </button>
                    <button
                      className="icon-btn"
                      aria-label={'删除分类 ' + c}
                      onClick={() => remove(item)}
                    >
                      <Trash2 size={12} />
                    </button>
                  </>
                )}
              </div>
            );
          })
        ) : (
          <p className="side-hint">从第一份资料开始，慢慢建立你的分类。</p>
        )}
        {tags.length > 0 && (
          <>
            <div className="side-heading">标签</div>
            <div className="tags">
              {tags.map((t) => (
                <button
                  className="tag"
                  aria-pressed={tag === t}
                  key={t}
                  onClick={() => {
                    setTag(tag === t ? '' : t);
                    go('library');
                  }}
                >
                  #{t}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="side-bottom">
          <button
            className={'nav-item ' + (view === 'trash' ? 'active' : '')}
            onClick={() => go('trash')}
          >
            <Trash2 />
            回收站
          </button>
          <div className="local-state">
            <i /> {browserEdition ? "数据仅存此浏览器" : "数据保存在此电脑"}
          </div>
          <button
            className={'nav-item ' + (view === 'settings' ? 'active' : '')}
            onClick={() => go('settings')}
          >
            <Settings />
            设置与备份
          </button>
        </div>
      </WorkspaceNavigation>
      <main className="main">
        <header className="topbar">
          <div className="toolbar">
            <button
              className="icon-btn mobile-toggle"
              aria-label={mobile ? '收起导航' : '展开导航'}
              aria-expanded={mobile}
              aria-controls="workspace-navigation"
              onClick={() => setMobile(!mobile)}
            >
              <Menu />
            </button>
            <span>
              知识库{' '}
              <span className="crumb">
                /{' '}
                {manual?.title ||
                  {
                    library: '全部说明书',
                    favorites: '收藏速查',
                    imports: '导入中心',
                    settings: '设置与备份',
                    trash: '回收站',
                    search: '搜索结果',
                  }[view]}
              </span>
            </span>
          </div>
          <div className="toolbar">
            <button
              className="topbar-search"
              title="快速搜索 · Ctrl+K"
              aria-label="快速搜索"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={requestSearch}
            >
              <Search />
              <span>搜索资料</span><kbd>Ctrl K</kbd>
            </button>
            <button
              className="topbar-assistant"
              title="AI 助手"
              aria-label="打开 AI 助手"
              onClick={() => setAi({ manualId: manualId || undefined })}
            >
              <Sparkles />
              <span>AI 助手</span>
            </button>
            <span className="avatar">我</span>
          </div>
        </header>
        <div className={'page ' + (manual ? 'manual-page' : 'page-' + view)}>
          <div hidden={view !== 'imports' || !!manual}>
            <>
              <PageHeading
                title="导入中心"
                subtitle="选择归属说明书，添加文件、截图、网页或文字。"
              />
              <ImportPanel
                manuals={manuals}
                active={view === 'imports' && !manual}
                initialManual={searchManual}
                newRequest={importRequest}
                onOpen={openManual}
                onNew={() => setEdit({ kind: 'manual' })}
                refresh={refresh}
                notify={notify}
                jobs={jobs}
              />
              <h2 style={{ fontSize: 17, margin: '30px 0 15px' }}>
                处理记录{' '}
                <span className="muted">
                  {pendingJobs > 0 ? pendingJobs + ' 个任务进行中' : ''}
                </span>
              </h2>
              {jobsQ.error && (
                <ErrorFeedback
                  message={jobsQ.error.message}
                  onRetry={() => void jobsQ.refetch()}
                />
              )}
              {jobsQ.isLoading && <LoadingCards label="正在加载处理记录" />}
              {jobs.length ? (
                <ReflowList>
                  {jobs.map((j) => (
                    <div className="panel" key={j.id}>
                      <div className="card-top">
                        <div>
                          <h3>{j.title}</h3>
                          <span className="muted">{j.stage}</span>
                        </div>
                        <div className="toolbar">
                          {j.status === 'error' || j.status === 'cancelled' ? (
                            <Button
                              variant="outline"
                              onClick={() =>
                                act(
                                  () => post('/jobs/' + j.id + '/retry'),
                                  '已加入重试队列',
                                )
                              }
                            >
                              <RotateCcw />
                              重试
                            </Button>
                          ) : j.status === 'done' ? (
                            <Check size={17} color="#7c925f" />
                          ) : (
                            <Button
                              variant="ghost"
                              onClick={() =>
                                act(
                                  () => post('/jobs/' + j.id + '/cancel'),
                                  '任务已取消',
                                )
                              }
                            >
                              取消
                            </Button>
                          )}
                        </div>
                      </div>
                      {j.error && (
                        <p className="error" style={{ marginTop: 10 }}>
                          {j.error}
                        </p>
                      )}
                      <Progress
                        value={j.progress}
                        label={j.title + '解析进度'}
                      />
                    </div>
                  ))}
                </ReflowList>
              ) : (
                <div className="empty">
                  <Upload />
                  还没有导入任务。
                </div>
              )}
            </>
          </div>
          {entriesQ.error && (
            <div className="error">
              无法连接本地服务：{entriesQ.error.message}。请确认应用已启动。
              <Button variant="ghost" onClick={() => entriesQ.refetch()}>
                重试
              </Button>
            </div>
          )}
          {manual ? (
            <>
              <button className="source-link" onClick={() => go('library')}>
                <ArrowLeft size={13} /> 返回资料库
              </button>
              <div className="page-heading manual-heading" style={{ marginTop: 20 }}>
                <div>
                  <div className="eyebrow">
                    {manual.category || 'MY MANUAL'}
                  </div>
                  <h1 tabIndex={-1}>{manual.title}</h1>
                  <p>
                    {[
                      manual.attrs.brand,
                      manual.attrs.model,
                      manual.attrs.device,
                    ]
                      .filter(Boolean)
                      .join(' · ') || manual.attrs.description || '说明资料与使用经验，集中在这里。'}
                  </p>
                  <div className="tags">
                    {manual.tags.map((t) => (
                      <span className="tag" key={t}>
                        #{t}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="toolbar">
                  <Button
                    variant="outline"
                    onClick={() => setEdit({ entry: manual, kind: 'manual' })}
                  >
                    <Edit3 />
                    编辑
                  </Button>
                  <Button
                    className="primary-action"
                    onClick={() => {
                      setView('imports');
                      setManualId(null);
                      setSearchManual(manual.id);
                    }}
                  >
                    <Upload />
                    导入资料
                  </Button>
                </div>
              </div>
              <div className="toolbar manual-tools">
                <Button variant="secondary" onClick={() => setAi({ manualId: manual.id })}><Sparkles />问问这本说明书</Button>
                <Button variant="outline" onClick={() => setOrganize(manual)}><Sparkles />AI 生成章节与卡片</Button>
                <span className="manual-meta">{chapters.length} 个章节 · {date(manual.updated_at)} 更新</span>
                <DropdownMenu>
                  <DropdownMenuTrigger className="more-trigger" render={<Button variant="outline" />}>更多操作</DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="workspace-menu">
                    <DropdownMenuItem onClick={() => setAi({ manualId: manual.id, purpose: 'summary' })}><Sparkles />生成摘要</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => act(() => post('/manuals/' + manual.id + '/index'), '已加入 AI 索引队列')}><RefreshCw />更新 AI 索引</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" className="manual-delete" aria-label="删除说明书" onClick={() => remove(manual)}><Trash2 />删除</Button>
              </div>
              <MetadataAssistant key={manual.id} manual={manual} jobs={jobs} refresh={refresh} onEdit={() => setEdit({kind:'manual', entry:manual})}/>
              {!manual.attrs.ai_enabled && (
                <p className="notice ai-scope-notice" style={{ marginTop: 15 }}>
                  这本说明书尚未开启云端
                  AI。可在“编辑”中开启；正文会用于所配置服务的信息识别、分类与问答。
                </p>
              )}
              <div className="section-tabs">
                {[
                  ['content', '章节与卡片'],
                  ['sources', '原始资料'],
                  ['notes', '我的经验'],
                ].map(([id, name]) => (
                  <button
                    key={id}
                    className={detailTab === id ? 'active' : ''}
                    aria-pressed={detailTab === id}
                    onClick={() => setDetailTab(id)}
                  >
                    {name}{' '}
                    <small>
                      {
                        children.filter((e) =>
                          id === 'sources'
                            ? e.kind === 'source'
                            : id === 'notes'
                              ? e.kind === 'note'
                              : e.kind === 'card',
                        ).length
                      }
                    </small>
                  </button>
                ))}
              </div>
              {detailTab === 'sources' ? (
                <>
                  <ReflowList>
                    {children
                      .filter((e) => e.kind === 'source')
                      .map((s) => (
                        <div className="panel" key={s.id}>
                          <div className="list-row">
                            <div>
                              <h3>{s.title}</h3>
                              <span className="muted">
                                {s.attrs.status === 'ready'
                                  ? '已解析 · ' +
                                    (s.attrs.pages ||
                                      s.attrs.block_count ||
                                      0) +
                                    ' ' +
                                    (s.attrs.pages ? '页' : '段')
                                  : '等待解析'}{' '}
                                · {date(s.created_at)}
                              </span>
                            </div>
                            <div className="toolbar">
                              <Button
                                variant="outline"
                                onClick={() => setReader({ id: s.id })}
                              >
                                阅读
                              </Button>
                              <button
                                className="icon-btn"
                                aria-label={'删除 ' + s.title}
                                onClick={() => remove(s)}
                              >
                                <Trash2 />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                  </ReflowList>
                  {!children.some((e) => e.kind === 'source') && (
                    <div className="empty">
                      <FileText />
                      还没有原始资料，点击上方“导入资料”开始。
                    </div>
                  )}
                </>
              ) : (
                <div className="detail-grid">
                  <aside className="chapter-directory">
                    <details open>
                    <summary>章节目录 <span>{chapters.length}</span><ChevronDown size={15} /></summary>
                    <div className="card-top">
                      <span className="muted">选择章节，专注阅读</span>
                      <button
                        aria-label="新增章节"
                        className="icon-btn"
                        onClick={() => newEntry('chapter')}
                      >
                        <Plus />
                      </button>
                    </div>
                    <button
                      className={'nav-item ' + (!chapter ? 'active' : '')}
                      onClick={() => setChapter('')}
                    >
                      全部内容
                    </button>
                    <ChapterList
                      chapters={chapters}
                      selected={chapter}
                      onSelect={setChapter}
                      onEdit={(e) => setEdit({ kind: 'chapter', entry: e })}
                      onRemove={remove}
                      onReorder={async (items) => {
                        try {
                          await post('/chapters/reorder', {
                            items: items.map((e) => ({
                              id: e.id,
                              revision: e.revision,
                            })),
                          });
                          await refresh();
                        } catch (error) {
                          await refresh();
                          throw error;
                        }
                      }}
                    />
                    </details>
                  </aside>
                  <section className="reading-column" aria-label="知识内容">
                    <div className="filterbar" style={{ marginTop: 0 }}>
                      <span>
                        {chapter
                          ? chapters.find((c) => c.id === chapter)?.title
                          : detailTab === 'notes' ? '全部经验' : '全部知识卡片'}
                      </span>
                      <Button
                        variant="outline"
                        onClick={() =>
                          newEntry(detailTab === 'notes' ? 'note' : 'card')
                        }
                      >
                        <Plus />
                        {detailTab === 'notes' ? '记录经验' : '新建卡片'}
                      </Button>
                    </div>
                    <ReflowList>
                      {children
                        .filter(
                          (e) =>
                            e.kind ===
                              (detailTab === 'notes' ? 'note' : 'card') &&
                            (!chapter || e.parent_id === chapter),
                        )
                        .map((card) => (
                          <ContentCard
                            key={card.id}
                            entry={card}
                            onEdit={() =>
                              setEdit({ entry: card, kind: card.kind })
                            }
                            onStar={() =>
                              act(
                                () => patch(card, { favorite: !card.favorite }),
                                '收藏已更新',
                              )
                            }
                            onRemove={() => remove(card)}
                            onSource={() => openCardSource(card)}
                          />
                        ))}
                    </ReflowList>
                    {!children.some(
                      (e) =>
                        e.kind === (detailTab === 'notes' ? 'note' : 'card') &&
                        (!chapter || e.parent_id === chapter),
                    ) && (
                      <div className="empty">
                        <StickyNote />
                        这里还很安静。
                        <br />
                        写下第一条经验，或从原文收藏一个片段。
                      </div>
                    )}
                  </section>
                </div>
              )}
            </>
          ) : view === 'library' ? (
            <>
              <PageHeading
                title={category || '我的说明书'}
                subtitle={
                  tag
                    ? '标签：#' + tag
                    : '把资料收好，让需要的答案随手可得。'
                }
                action={
                  <div className="toolbar library-actions">
                  <Button variant="outline" onClick={() => go('imports')}><Upload />导入资料</Button>
                  <Button
                    className="primary-action"
                    onClick={() => startNewManual()}
                  >
                    <Plus />
                    新建说明书
                  </Button>
                  </div>
                }
              />
              {manuals.length > 0 && (
                <div className="library-overview" aria-label="资料库概览">
                  <div className="library-totals">
                    <span><strong>{manuals.length}</strong> 本说明书</span>
                    <span><strong>{entries.filter(e => e.kind === 'source').length}</strong> 份原始资料</span>
                    <span><strong>{entries.filter(e => e.kind === 'card' || e.kind === 'note').length}</strong> 张卡片与经验</span>
                  </div>
                  <button className="continue-reading" onClick={() => openManual([...manuals].sort((a,b) => b.updated_at.localeCompare(a.updated_at))[0].id)}>
                    <BookOpen size={17}/><span><small>最近更新 · 继续阅读</small><strong>{[...manuals].sort((a,b) => b.updated_at.localeCompare(a.updated_at))[0].title}</strong></span><ArrowRight size={17}/>
                  </button>
                </div>
              )}
              <form className="search-bar" onSubmit={runSearch}>
                <Search />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="搜索设备、型号，或问一个问题…"
                  aria-label="搜索资料"
                />
                {q && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="清空搜索"
                    onClick={() => {
                      clearSearch();
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
                <kbd>Ctrl K</kbd>
              </form>
              <div className="filterbar">
                <div>
                  <button
                    className={'filter ' + (!recent ? 'active' : '')}
                    aria-pressed={!recent}
                    onClick={() => setRecent(false)}
                  >
                    全部资料
                  </button>
                  <button
                    className={'filter ' + (recent ? 'active' : '')}
                    aria-pressed={recent}
                    onClick={() => setRecent(true)}
                  >
                    最近更新
                  </button>
                  {(category || tag) && (
                    <button
                      className="filter"
                      onClick={() => {
                        setCategory('');
                        setTag('');
                      }}
                    >
                      清除筛选 ×
                    </button>
                  )}
                </div>
                <div className="library-view-controls">
                <span className="result-count">
                  {manuals.length
                    ? filteredManuals.length + ' 本说明书'
                    : '你的知识，从这里开始'}
                </span>
                <div className="view-switch" role="group" aria-label="资料显示方式">
                  <button aria-label="卡片视图" aria-pressed={libraryLayout === 'grid'} onClick={() => setLibraryLayout('grid')}><LayoutGrid size={16}/></button>
                  <button aria-label="列表视图" aria-pressed={libraryLayout === 'list'} onClick={() => setLibraryLayout('list')}><List size={16}/></button>
                </div>
                </div>
              </div>
              {entriesQ.isLoading ? (
                <LoadingCards />
              ) : !manuals.length ? (
                <Welcome
                  onNew={() => startNewManual()}
                  onImport={() => go('imports')}
                  onAI={() => go('settings')}
                />
              ) : (
                <ReflowList className={'card-grid library-grid ' + (libraryLayout === 'list' ? 'library-list' : '')}>
                  {filteredManuals.map((m) => (
                    <ManualCard
                      key={m.id}
                      entry={m}
                      count={
                        entries.filter(
                          (e) => e.manual_id === m.id && e.kind === 'source',
                        ).length
                      }
                      onOpen={() => openManual(m.id)}
                      onStar={() =>
                        act(
                          () => patch(m, { favorite: !m.favorite }),
                          '收藏已更新',
                        )
                      }
                    />
                  ))}
                  {!filteredManuals.length && <div className="filtered-empty"><Search size={24}/><h2>没有符合筛选的说明书</h2><p>换个分类或标签，查看其他资料。</p><Button variant="outline" onClick={() => {setCategory(''); setTag('');}}>清除筛选</Button></div>}
                  <button
                    className="new-card"
                    onClick={() => startNewManual()}
                  >
                    <span className="new-card-icon"><Plus size={22} /></span>
                    <strong>新建一本说明书</strong>
                    <span>给下一份知识留个位置</span>
                  </button>
                </ReflowList>
              )}
              <div className="bottom-note">
                <span className="brand-icon small">
                  <BookOpen size={17} />
                </span>
                <p>
                  一本说明书，可以装下原件、章节、知识卡片，以及你的使用经验。
                </p>
              </div>
            </>
          ) : view === 'imports' ? null : view === 'favorites' ? (
            <>
              <PageHeading
                title="收藏速查"
                subtitle="那些经常用到的知识，不必再找第二遍。"
              />
              <ReflowList className="card-grid">
                {entries
                  .filter((e) => e.favorite && e.kind === 'manual')
                  .map((m) => (
                    <ManualCard
                      key={m.id}
                      entry={m}
                      count={
                        entries.filter(
                          (e) => e.manual_id === m.id && e.kind === 'source',
                        ).length
                      }
                      onOpen={() => openManual(m.id)}
                      onStar={() =>
                        act(() => patch(m, { favorite: false }), '已取消收藏')
                      }
                    />
                  ))}
              </ReflowList>
              <div style={{ marginTop: 20 }}>
                <ReflowList>
                  {entries
                    .filter(
                      (e) => e.favorite && ['note', 'card'].includes(e.kind),
                    )
                    .map((e) => (
                      <ContentCard
                        key={e.id}
                        entry={e}
                        onEdit={() => setEdit({ entry: e, kind: e.kind })}
                        onStar={() =>
                          act(() => patch(e, { favorite: false }), '已取消收藏')
                        }
                        onRemove={() => remove(e)}
                        onSource={() => openCardSource(e)}
                      />
                    ))}
                </ReflowList>
              </div>
              {!entries.some((e) => e.favorite) && (
                <div className="empty">
                  <Star />
                  点击说明书或卡片上的星标，即可收藏到这里。
                </div>
              )}
            </>
          ) : view === 'search' ? (
            <>
              <PageHeading
                title="找回你的知识"
                subtitle="从一个关键词，到一个有出处的答案。"
              />
              <form className="search-bar" onSubmit={runSearch}>
                <Search />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  aria-label="搜索资料"
                  placeholder="输入型号、关键词或问题"
                />
                {q && (
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label="清空搜索"
                    onClick={() => {
                      clearSearch();
                    }}
                  >
                    <X size={15} />
                  </button>
                )}
                <Button type="submit" disabled={searching || !q.trim()}>
                  {searching && <LoaderCircle className="spin" size={15} />}
                  {searching ? '检索中' : '搜索'}
                </Button>
              </form>
              <div className="filterbar">
                <div>
                  {[
                    ['keyword', '关键词搜索'],
                    ['semantic', '语义搜索'],
                    ['hybrid', '混合搜索'],
                  ].map(([v, t]) => (
                    <button
                      className={'filter ' + (searchMode === v ? 'active' : '')}
                      aria-pressed={searchMode === v}
                      key={v}
                      onClick={() => setSearchMode(v)}
                    >
                      {t}
                    </button>
                  ))}
                  <select
                    className="select"
                    style={{ width: 160 }}
                    value={searchManual}
                    onChange={(e) => setSearchManual(e.target.value)}
                    aria-label="搜索范围"
                  >
                    <option value="">全部说明书</option>
                    {manuals.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.title}
                      </option>
                    ))}
                  </select>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => setAi({ manualId: searchManual || undefined })}
                >
                  <Sparkles />向 AI 提问
                </Button>
              </div>
              <p className="search-state" role="status">
                {searching
                  ? '正在检索「' + submittedQuery + '」…'
                  : searchError
                    ? '检索未完成，可重试'
                    : !submittedQuery
                      ? q.trim()
                        ? '按 Enter 开始检索'
                        : '输入关键词或问题开始检索'
                      : searchEdited
                        ? '内容已修改，按 Enter 更新结果；下方为「' +
                          submittedQuery +
                          '」的结果'
                        : '找到 ' + hits.length + ' 条结果'}
              </p>
              {searchError && (
                <ErrorFeedback
                  message={searchError}
                  onRetry={() =>
                    void runSearch(undefined, lastSearch.current || undefined)
                  }
                />
              )}
              {searchWarning && <p className="notice">{searchWarning}</p>}
              {searching && !hits.length && (
                <LoadingCards label="正在检索资料" />
              )}
              <div className="search-results" aria-busy={searching}>
                {!!hits.length && (searching || searchError) && (
                  <p className="muted">
                    下方保留上次「{resolvedQuery}」的结果。
                  </p>
                )}
                <ReflowList>
                  {hits.map((hit) => (
                    <div className="result" key={hit.id}>
                      <span
                        className={
                          'match-label ' +
                          (usedMode !== 'keyword' ? 'semantic' : '')
                        }
                      >
                        {usedMode === 'semantic'
                          ? '语义相关'
                          : usedMode === 'hybrid'
                            ? '关键词 + 语义相关'
                            : (hit.title + ' ' + hit.text)
                                  .toLocaleLowerCase()
                                  .includes(resolvedQuery.toLocaleLowerCase())
                              ? '完整词句匹配'
                              : '关键词相关'}
                      </span>
                      <div className="muted">
                        {manuals.find((m) => m.id === hit.manual_id)?.title} ·{' '}
                        {hit.kind === 'note'
                          ? '个人经验'
                          : hit.kind === 'card'
                            ? '知识卡片'
                            : '资料原文'}
                      </div>
                      <button
                        style={{
                          border: 0,
                          background: 'none',
                          padding: 0,
                          textAlign: 'left',
                        }}
                        onClick={() => openHit(hit)}
                      >
                        <h3>
                          {hit.title}{' '}
                          <ArrowUpRight
                            size={14}
                            style={{ display: 'inline' }}
                          />
                        </h3>
                      </button>
                      <p>{hit.text.slice(0, 350)}</p>
                      <button
                        className="source-link"
                        onClick={() => openHit(hit)}
                      >
                        <FileText size={12} />
                        {hit.locator.page
                          ? '第 ' + hit.locator.page + ' 页'
                          : '查看来源'}
                      </button>
                    </div>
                  ))}
                </ReflowList>
              </div>
              {!searching && !searchError && submittedQuery && !hits.length && (
                <div className="empty">
                  <Search />
                  没有找到匹配内容。试试其他关键词或调整搜索范围。
                  <Button
                    variant="outline"
                    onClick={() => {
                      clearSearch();
                      setSearchManual('');
                      setCategory('');
                      setTag('');
                    }}
                  >
                    清除条件，重新搜索
                  </Button>
                </div>
              )}
            </>
          ) : view === 'trash' ? (
            <>
              <PageHeading
                title="回收站"
                subtitle="暂时放下，也可以重新找回。原始附件始终保留。"
              />
              {trashQ.isLoading && <LoadingCards label="正在加载回收站" />}
              {trashQ.error && (
                <ErrorFeedback
                  message={trashQ.error.message}
                  onRetry={() => void trashQ.refetch()}
                />
              )}
              <ReflowList>
                {trashQ.data?.items
                  .filter(
                    (e) =>
                      e.kind === 'manual' ||
                      !trashQ.data?.items.some(
                        (x) => x.id === e.manual_id || x.id === e.parent_id,
                      ),
                  )
                  .map((e) => (
                    <div className="panel" key={e.id}>
                      <div className="card-top">
                        <div>
                          <h3>{e.title}</h3>
                          <span className="muted">
                            {e.kind === 'manual' ? '说明书' : '资料'} ·{' '}
                            {date(e.deleted_at!)}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          onClick={() =>
                            act(
                              () => post('/entries/' + e.id + '/restore'),
                              '已恢复',
                            )
                          }
                        >
                          <RotateCcw />
                          恢复
                        </Button>
                      </div>
                    </div>
                  ))}
              </ReflowList>
              {!trashQ.isLoading &&
                !trashQ.error &&
                !trashQ.data?.items.length && (
                  <div className="empty">
                    <Trash2 />
                    回收站是空的。
                  </div>
                )}
            </>
          ) : (
            <SettingsPanel notify={notify} refresh={refresh} />
          )}
        </div>
      </main>
      <AnimatePresence>
        {notice && (
          <ActionToast
            key={notice.id}
            notice={notice}
            onClose={dismissNotice}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {edit && (
          <EditDialog
            key={edit.entry?.id || edit.kind + (edit.parent_id || '')}
            spec={edit}
            manuals={manuals}
            categories={categoryNames}
            chapters={entries.filter((e) => e.kind === 'chapter')}
            onClose={() => setEdit(null)}
            onSave={async (value, extra) => {
              if (edit.entry) {
                if (extra?.mergeTarget) {
                  const target = entries.find(
                    (e) => e.id === extra.mergeTarget,
                  )!;
                  await post('/chapters/merge', {
                    source_id: edit.entry.id,
                    target_id: target.id,
                    source_revision: edit.entry.revision,
                    target_revision: target.revision,
                  });
                } else await patch(edit.entry, value);
              } else {
                const created = await post<Entry>('/entries', value);
                if (created.kind === 'manual') {
                  setSearchManual(created.id);
                  openManual(created.id);
                }
              }
              await refresh();
              setEdit(null);
              notify('已保存');
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {reader && (
          <SourceReader
            {...reader}
            onClose={() => setReader(null)}
            onClip={(source, block) => {
              setEdit({
                kind: 'card',
                manual_id: source.manual_id!,
                content:
                  '<p>' +
                  block.text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/\n/g, '<br>') +
                  '</p>',
                attrs: { source_id: source.id, locator: block.locator },
              });
              setReader(null);
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {organize && (
          <OrganizePanel
            manual={organize}
            onClose={() => setOrganize(null)}
            onDone={() => {
              setOrganize(null);
              void refresh();
              setDetailTab('content');
              setChapter('');
              notify('AI 章节与卡片已加入，可继续编辑');
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {ai && (
          <AIPanel
            manuals={manuals}
            initial={ai}
            onClose={() => setAi(null)}
            onSource={openHit}
            onSave={(text, mid) => {
              setEdit({
                kind: 'note',
                manual_id: mid || undefined,
                content:
                  '<p>' +
                  text
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/\n/g, '<br>') +
                  '</p>',
              });
              setAi(null);
            }}
            onSettings={() => {
              setAi(null);
              go('settings');
            }}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirm && (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open && !actionBusy) setConfirm(null);
            }}
          >
            <DialogContent>
              <DialogTitle>移至回收站</DialogTitle>
              <DialogDescription>{confirm.message}</DialogDescription>
              <div className="toolbar">
                <Button
                  variant="outline"
                  disabled={actionBusy}
                  onClick={() => setConfirm(null)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={actionBusy}
                  onClick={async () => {
                    setActionBusy(true);
                    try {
                      await confirm.run();
                      setConfirm(null);
                    } catch (e) {
                      notify((e as Error).message, { tone: 'error' });
                    } finally {
                      setActionBusy(false);
                    }
                  }}
                >
                  {actionBusy ? '处理中' : '确认移入'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
function PageHeading({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">
          A LITTLE LESS SEARCHING, A LOT MORE KNOWING
        </div>
        <h1>
          {title}
          {!/[。.!！?？]$/.test(title) && <span className="title-dot">.</span>}
        </h1>
        <p>{subtitle}</p>
      </div>
      {action}
    </div>
  );
}
function Welcome({
  onNew,
  onImport,
  onAI,
}: {
  onNew: () => void;
  onImport: () => void;
  onAI: () => void;
}) {
  const cards = [
    {
      color: 'yellow',
      icon: StickyNote,
      kicker: '开始记录',
      title: (
        <>
          给你的设备，
          <br />
          建一本专属说明书。
        </>
      ),
      text: '收集 PDF、网页和截图，把使用心得也放在一起。下次需要时，轻松找到。',
      link: '新建第一本说明书',
      action: onNew,
    },
    {
      color: 'blue',
      icon: Upload,
      kicker: '多种方式导入',
      title: (
        <>
          零散的资料，
          <br />
          都有自己的位置。
        </>
      ),
      text: '拖入文档、粘贴截图，或保存一个链接。原件留在本机，内容整理到卡片。',
      link: '打开导入中心',
      action: onImport,
    },
    {
      color: 'green',
      icon: Sparkles,
      kicker: '让知识回应你',
      title: (
        <>
          从「我记得」，
          <br />
          到「我找到了」。
        </>
      ),
      text: '关键词搜索与 AI 问答，把说明书和你的经验连接起来。每个答案，都有出处。',
      link: '配置 AI 服务',
      action: onAI,
    },
  ];
  return (
    <div className="welcome-grid">
      {cards.map((c) => (
        <section key={c.color} className={'welcome-note note-' + c.color}>
          <span className="note-kicker">
            <c.icon size={17} />
            {c.kicker}
          </span>
          <h2>{c.title}</h2>
          <p>{c.text}</p>
          <button
            className="note-link"
            style={{
              background: 'none',
              border: 0,
              padding: 0,
              textAlign: 'left',
            }}
            onClick={c.action}
          >
            {c.link}
            <ArrowUpRight size={17} />
          </button>
        </section>
      ))}
    </div>
  );
}
function ManualCard({
  entry: e,
  count,
  onOpen,
  onStar,
}: {
  entry: Entry;
  count: number;
  onOpen: () => void;
  onStar: () => void | Promise<void>;
}) {
  return (
    <article
      className={'manual-card note-' + e.color}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ')
        ) {
          event.preventDefault();
          onOpen();
        }
      }}
      tabIndex={0}
      aria-label={'打开 ' + e.title}
    >
      <div className="card-top">
        <span>
          <BookOpen size={15} style={{ display: 'inline', marginRight: 6 }} />
          {e.category || '未分类'}
        </span>
        <FavoriteButton
          active={e.favorite}
          label={(e.favorite ? '取消收藏 ' : '收藏 ') + e.title}
          onToggle={onStar}
        />
      </div>
      <h2>{e.title}</h2>
      <p className="summary">
        {strip(e.content) ||
          e.attrs.description ||
          [e.attrs.brand, e.attrs.model].filter(Boolean).join(' · ') ||
          '把说明资料、使用方法和自己的经验，慢慢收集在这里。'}
      </p>
      <div className="tags">
        {e.tags.slice(0, 4).map((t) => (
          <span className="tag" key={t}>
            #{t}
          </span>
        ))}
      </div>
      <div className="card-footer">
        <span>{count} 份原始资料</span>
        <span>
          {date(e.updated_at)} 更新{' '}
          <ArrowUpRight size={12} style={{ display: 'inline' }} />
        </span>
      </div>
    </article>
  );
}
function ContentCard({
  entry: e,
  onEdit,
  onStar,
  onRemove,
  onSource,
}: {
  entry: Entry;
  onEdit: () => void;
  onStar: () => void | Promise<void>;
  onRemove: () => void;
  onSource: () => void;
}) {
  return (
    <article id={'entry-' + e.id} className="content-card">
      <div className="card-top">
        <h3>{e.title}</h3>
        <div className="toolbar">
          <FavoriteButton
            active={e.favorite}
            label={e.favorite ? '取消收藏卡片' : '收藏卡片'}
            onToggle={onStar}
          />
          <button className="icon-btn" aria-label="编辑卡片" onClick={onEdit}>
            <Edit3 />
          </button>
          <button className="icon-btn" aria-label="删除卡片" onClick={onRemove}>
            <Trash2 />
          </button>
        </div>
      </div>
      <SafeHTML html={e.content} />
      {(e.attrs.source_id || e.attrs.reference_entry_id) && (
        <button className="source-link" onClick={onSource}>
          <FileText size={12} />
          {e.attrs.locator?.page
            ? '原文 · 第 ' + e.attrs.locator.page + ' 页'
            : '查看原始出处'}
        </button>
      )}
      <div className="tags">
        {e.tags.map((t) => (
          <span key={t} className="tag">
            #{t}
          </span>
        ))}
      </div>
    </article>
  );
}
