'use client';
import { browserEdition } from '@/lib/edition';
import { useEffect, useRef, useState } from 'react';
import { Upload, Camera, ImagePlus, Link, FileText, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { post, type Entry, type Job } from '@/lib/api';
import { uploadFile, eachFile } from '@/lib/upload';
import {
  ReflowList,
  Progress,
  ErrorFeedback,
  SuccessMark,
  useHaptic,
} from '@/components/tactile';

type UploadRow = {
  id: string;
  file: File;
  manualId: string;
  newManual: boolean;
  autoIdentify: boolean;
  phase:
    | 'queued'
    | 'uploading'
    | 'processing'
    | 'error'
    | 'duplicate'
    | 'reused';
  progress: number;
  error?: string;
  jobId?: string;
};

export default function ImportPanel({
  manuals,
  initialManual,
  onNew,
  refresh,
  notify,
  jobs,
  active,
  newRequest = 0,
  onOpen,
}: {
  manuals: Entry[];
  jobs: Job[];
  active: boolean;
  newRequest?: number;
  onOpen: (id: string) => void;
  initialManual: string;
  onNew: () => void;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [mid, setMid] = useState(initialManual || '__new__'),
    [mode, setMode] = useState('file'),
    [url, setUrl] = useState(''),
    [text, setText] = useState(''),
    [title, setTitle] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [status, setStatus] = useState(''),
    [camera, setCamera] = useState(false);
  const [autoIdentify, setAutoIdentify] = useState(!browserEdition);
  const [createdManual, setCreatedManual] = useState('');
  const urlRequestId = useRef('');
  useEffect(() => { if (newRequest) setMid('__new__'); }, [newRequest]);
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const pending = useRef(false);
  const visible = useRef(active);
  visible.current = active;
  const pulse = useHaptic();
  const completedJobs = useRef(new Set<string>());
  useEffect(() => {
    for (const row of uploads) {
      const job = jobs.find((j) => j.id === row.jobId);
      if (
        job &&
        ['done', 'error'].includes(job.status) &&
        !completedJobs.current.has(job.id)
      ) {
        completedJobs.current.add(job.id);
        pulse(job.status === 'done' ? 'success' : 'error');
      }
    }
  }, [jobs, uploads, pulse]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);
  const input = useRef<HTMLInputElement>(null),
    video = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null);
  useEffect(() => {
    if (!pending.current && mid !== '__new__' && !manuals.some((manual) => manual.id === mid))
      setMid('__new__');
  }, [manuals, mid, busy]);
  useEffect(
    () => () => stream.current?.getTracks().forEach((t) => t.stop()),
    [],
  );
  const uploadRef = useRef<(files: File[]) => Promise<void>>(async () => {});
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files || []);
      if (
        visible.current &&
        files.length &&
        !document.querySelector('[role=dialog]')
      ) {
        event.preventDefault();
        void uploadRef.current(files);
      }
    };
    window.addEventListener('paste', paste);
    return () => window.removeEventListener('paste', paste);
  }, []);
  function updateRow(id: string, change: Partial<UploadRow>) {
    setUploads((rows) =>
      rows.map((row) => (row.id === id ? { ...row, ...change } : row)),
    );
  }
  async function processRows(rows: UploadRow[], allowDuplicate = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await eachFile(
        rows,
        async (row) => {
          updateRow(row.id, {
            phase: 'uploading',
            progress: 0,
            error: undefined,
          });
          const result = await uploadFile(
            row.file,
            row.newManual ? '' : row.manualId,
            (progress) => updateRow(row.id, { progress }),
            allowDuplicate,
            {newManual: row.newManual, autoIdentify: row.autoIdentify, requestId: row.id},
          );
          updateRow(row.id, {
            phase: result.duplicate ? 'duplicate' : 'processing',
            progress: 100,
            jobId: result.job_id,
            manualId: result.source?.manual_id || row.manualId,
          });
        },
        (row, error) => {
          updateRow(row.id, { phase: 'error', error: error.message });
          pulse('error');
        },
      );
      await refresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  async function upload(files: File[]) {
    if (pending.current || !files.length) return;
    if (!mid) {
      notify('请先新建或选择一本说明书');
      return;
    }
    const rows: UploadRow[] = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      manualId: mid,
      newManual: mid === '__new__',
      autoIdentify,
      phase: 'queued',
      progress: 0,
    }));
    setUploads((previous) => [...previous, ...rows]);
    await processRows(rows);
  }
  uploadRef.current = upload;
  async function importURL() {
    if (!mid || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      if (!urlRequestId.current) urlRequestId.current = crypto.randomUUID();
      const result = await post('/imports/url', { manual_id: mid === '__new__' ? '' : mid, url, new_manual: mid === '__new__', auto_identify: autoIdentify, request_id: urlRequestId.current });
      setCreatedManual(result.source.manual_id);
      urlRequestId.current = '';
      setUrl('');
      setStatus('网页已加入导入队列');
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (initialManual && !pending.current) setMid(initialManual);
  }, [initialManual]);
  useEffect(() => {
    if (!active) {
      stream.current?.getTracks().forEach((t) => t.stop());
      setCamera(false);
    }
  }, [active]);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);
  async function startCamera() {
    setError('');
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (!visible.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      setCamera(true);
      setTimeout(() => {
        if (video.current) {
          video.current.srcObject = media;
          void video.current.play();
        }
      }, 50);
    } catch {
      setError('摄像头不可用或未授权，可以选择照片、截图或粘贴图片。');
    }
  }
  function closeCamera() {
    stream.current?.getTracks().forEach((t) => t.stop());
    setCamera(false);
  }
  function capture() {
    if (!video.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.current.videoWidth;
    canvas.height = video.current.videoHeight;
    canvas.getContext('2d')!.drawImage(video.current, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob)
          void upload([
            new File([blob], '拍照-' + Date.now() + '.jpg', {
              type: 'image/jpeg',
            }),
          ]);
        closeCamera();
      },
      'image/jpeg',
      0.9,
    );
  }
  return (
    <div className="panel">
      <div className="field-row">
        <label className="field" style={{ marginTop: 0 }}>
          导入方式
          <select
            disabled={busy}
            value={mid}
            onChange={(e) => setMid(e.target.value)}
          >
            <option value="__new__">{browserEdition ? "新建说明书 · 保存到此浏览器" : "新建说明书 · 导入后自动整理"}</option>
            {manuals.map((m) => (
              <option key={m.id} value={m.id}>
                添加到：{m.title}
              </option>
            ))}
          </select>
        </label>
        <div className="toolbar">
          <Button variant="ghost" disabled={busy} onClick={onNew}>
            手动新建空白说明书
          </Button>
        </div>
      </div>
      {browserEdition && <p className="notice">浏览器版：仅在此浏览器保存 TXT / Markdown 或粘贴文字。其他文件与 AI 自动整理请使用本地完整版。</p>}
      {mid === '__new__' && !browserEdition && (
        <div className="notice" style={{marginTop:16}}>
          <label className="toolbar" style={{cursor:'pointer'}}>
            <Checkbox checked={autoIdentify} onCheckedChange={checked => setAutoIdentify(!!checked)} disabled={busy}/>
            导入后由 AI 识别信息并自动分类
          </label>
          <p className="muted" style={{marginTop:8}}>无需先填型号。每个文件新建一本说明书；AI 根据正文与分类关键词整理，信息可随时手动修改。启用后会将提取的文字发送至设置中的对话服务。</p>
        </div>
      )}
      <div className="section-tabs">
        {[
          ['file', browserEdition ? 'TXT / Markdown' : '文件 / 图片'],
          ['url', '网页链接'],
          ['text', '粘贴文字'],
        ].map(([v, t]) => (
          <button
            key={v}
            className={mode === v ? 'active' : ''}
            aria-pressed={mode === v}
            disabled={browserEdition && v === 'url'} title={browserEdition && v === 'url' ? '网页提取需要本地完整版' : undefined} onClick={() => setMode(v)}
          >
            {t}
          </button>
        ))}
      </div>
      {mode === 'file' ? (
        <div
          className={
            'dropzone ' +
            (dragActive ? 'drag-active' : '') +
            (busy ? ' uploading' : '')
          }
          aria-busy={busy}
          onDragEnter={(e) => {
            e.preventDefault();
            if (e.dataTransfer.types.includes('Files')) {
              dragDepth.current++;
              setDragActive(!busy && !!mid);
            }
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            dragDepth.current = Math.max(0, dragDepth.current - 1);
            if (!dragDepth.current) setDragActive(false);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = busy || !mid ? 'none' : 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            dragDepth.current = 0;
            setDragActive(false);
            const files = Array.from(e.dataTransfer.files);
            if (files.length) void upload(files);
          }}
        >
          <Upload size={30} />
          <h3 aria-live="polite">
            {dragActive
              ? busy
                ? '正在上传，请稍候'
                : mid
                  ? '松开鼠标，收进说明书'
                  : '请先选择一本说明书'
              : '把资料拖到这里'}
          </h3>
          <p className="muted">
            {browserEdition ? "TXT 或 Markdown，文件仅保存到此浏览器" : "PDF、Word、照片、截图、TXT 或 Markdown"}
            <br />
            {browserEdition ? "每份最多 1 MB，也可以切换到粘贴文字。" : "每份最大 50 MB，PDF 最多 300 页。也可以直接粘贴截图。"}
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept={browserEdition ? ".txt,.md" : ".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,.bmp,.txt,.md"}
            style={{ display: 'none' }}
            aria-label="选择导入文件"
            onChange={(e) => {
              void upload(Array.from(e.target.files || []));
              e.target.value = '';
            }}
          />
          <div className="import-options">
            <Button
              disabled={busy || !mid}
              onClick={() => input.current?.click()}
            >
              <FileText />
              选择文件
            </Button>
            <Button
              variant="outline"
              disabled={browserEdition || busy || !mid}
              onClick={startCamera}
            >
              <Camera />
              拍照导入
            </Button>
          </div>
        </div>
      ) : mode === 'url' ? (
        <div>
          <label className="field">
            网页地址
            <Input
              value={url}
              onChange={(e) => {setUrl(e.target.value); urlRequestId.current = '';}}
              placeholder="https://…"
              type="url"
            />
          </label>
          <p className="muted">
            支持可直接访问的公开网页。登录页、动态页面可保存成 PDF 后导入。
          </p>
          <Button disabled={busy || !mid || !url.trim()} onClick={importURL}>
            <Link />
            保存网页
          </Button>
        </div>
      ) : (
        <div>
          <label className="field">
            资料标题
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="这段文字来自哪里？"
            />
          </label>
          <label className="field">
            正文
            <textarea
              style={{ minHeight: 180 }}
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="粘贴说明资料…"
            />
          </label>
          <Button
            disabled={busy || !mid || !text.trim()}
            onClick={async () => {
              await upload([
                new File([text], (title.trim() || '文字资料') + '.txt', {
                  type: 'text/plain',
                }),
              ]);
            }}
          >
            保存文字资料
          </Button>
        </div>
      )}
      {camera && (
        <div style={{ marginTop: 20 }}>
          <video
            ref={video}
            autoPlay
            playsInline
            style={{
              maxHeight: 400,
              width: '100%',
              background: '#222',
              borderRadius: 10,
            }}
          />
          <div className="toolbar">
            <Button onClick={capture}>
              <Camera />
              拍下并导入
            </Button>
            <Button variant="outline" onClick={closeCamera}>
              <X />
              关闭
            </Button>
          </div>
        </div>
      )}
      {!!uploads.length && (
        <ReflowList className="upload-list" label="本次导入的文件">
          {uploads.map((row) => {
            const job = jobs.find((j) => j.id === row.jobId);
            const identification = jobs.find(j => j.kind === 'identify' && j.source_id === row.manualId);
            const phase = job?.status || row.phase;
            const label =
              row.phase === 'uploading'
                ? row.progress < 100
                  ? '正在上传 ' + Math.round(row.progress) + '%'
                  : '文件已传输，正在确认接收…'
                : row.phase === 'queued'
                  ? '等待上传'
                  : row.phase === 'duplicate'
                    ? '这本说明书已有相同文件'
                    : row.phase === 'reused'
                      ? '已保留已有资料'
                      : row.phase === 'error'
                        ? '上传失败'
                        : job?.status === 'done'
                          ? identification?.status === 'done' ? '已识别并分类，可以阅读' : identification?.status === 'error' ? '原件可阅读，AI 识别待重试' : identification && ['queued', 'running'].includes(identification.status) ? identification.stage : '解析完成，可以阅读'
                          : job?.status === 'error'
                            ? '解析失败'
                            : job?.status === 'cancelled'
                              ? '解析已取消'
                              : job
                                ? job.stage
                                : '已接收，等待解析';
            return (
              <div className="upload-row" key={row.id} data-state={phase}>
                <div className="card-top">
                  <span className="upload-name">{row.file.name}</span>
                  <small className="muted">
                    {row.file.size < 1024 * 1024
                      ? Math.max(1, Math.round(row.file.size / 1024)) + ' KB'
                      : (row.file.size / 1024 / 1024).toFixed(2) + ' MB'}
                  </small>
                </div>
                <div
                  className="upload-status"
                  role={row.phase === 'uploading' ? undefined : 'status'}
                >
                  {job?.status === 'done' && <SuccessMark />}
                  {label}
                </div>
                {row.phase === 'uploading' && (
                  <Progress
                    value={row.progress}
                    label={row.file.name + '上传进度'}
                  />
                )}
                {job && ['queued', 'running', 'done'].includes(job.status) && (
                  <Progress
                    value={job.progress}
                    label={row.file.name + '解析进度'}
                  />
                )}
                {row.phase === 'error' && (
                  <ErrorFeedback
                    message={row.error || '上传失败'}
                    busy={busy}
                    onRetry={() => void processRows([row])}
                  />
                )}
                {job?.error && (
                  <p className="error">{job.error} · 在下方处理记录中重试。</p>
                )}
                {identification?.error && <p className="error">{identification.error} · 可在下方处理记录中重试，或进入说明书手动修改。</p>}
                {row.manualId && row.manualId !== '__new__' && row.phase !== 'queued' && row.phase !== 'uploading' && <Button variant="ghost" onClick={() => onOpen(row.manualId)}>查看说明书</Button>}
                {row.phase === 'duplicate' && (
                  <div className="toolbar">
                    <Button
                      variant="ghost"
                      disabled={busy}
                      onClick={() => updateRow(row.id, { phase: 'reused' })}
                    >
                      使用已有资料
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => void processRows([row], true)}
                    >
                      仍然另建资料
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </ReflowList>
      )}
      {status && (
        <p
          role="status"
          className={'muted ' + (busy ? 'busy' : '')}
          style={{ marginTop: 15 }}
        >
          {status}
        </p>
      )}
      {createdManual && <Button variant="outline" onClick={() => onOpen(createdManual)}>查看刚导入的说明书</Button>}
      {error && (
        <ErrorFeedback
          message={error}
          busy={busy}
          onRetry={
            mode === 'url' && url.trim()
              ? () => void importURL()
              : () => input.current?.click()
          }
        />
      )}
    </div>
  );
}
