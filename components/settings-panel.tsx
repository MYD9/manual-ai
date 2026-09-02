'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Upload, Check, KeyRound } from 'lucide-react';
import { InteractionSettings, ErrorFeedback } from '@/components/tactile';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, post } from '@/lib/api';
import ClassificationSettings from '@/components/classification-settings';
import { browserEdition } from '@/lib/edition';
import BrowserSettings from './browser-settings';
export default function SettingsPanel(props: { notify: (text: string) => void; refresh: () => Promise<void> }) {
  return browserEdition ? <BrowserSettings {...props} /> : <LocalSettingsPanel {...props} />;
}
function LocalSettingsPanel({
  notify,
  refresh,
}: {
  notify: (text: string) => void;
  refresh: () => Promise<void>;
}) {
  const {
    data,
    refetch,
    error: settingsError,
  } = useQuery({
    queryKey: ['settings'],
    queryFn: () => api('/settings'),
  });
  const [form, setForm] = useState<any>({
      chat_base: '',
      chat_model: '',
      chat_key: '',
      embedding_base: '',
      embedding_model: '',
      embedding_key: '',
      libreoffice_path: '',
    }),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  const restoreInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data && !dirty) setForm({ ...data, chat_key: '', embedding_key: '' });
  }, [data, dirty]);
  function field(key: string, value: string) {
    setDirty(true);
    setForm({ ...form, [key]: value });
  }
  async function save() {
    const payload = {
      chat_base: form.chat_base || '',
      chat_model: form.chat_model || '',
      embedding_base: form.embedding_base || '',
      embedding_model: form.embedding_model || '',
      libreoffice_path: form.libreoffice_path || '',
      ...(form.chat_key ? { chat_key: form.chat_key } : {}),
      ...(form.embedding_key ? { embedding_key: form.embedding_key } : {}),
    };
    await api('/settings', { method: 'PUT', body: JSON.stringify(payload) });
    setDirty(false);
    await refetch();
    setMessage('设置已保存，密钥仅保存在本机加密存储。');
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function backup() {
    const response = await fetch('/api/v1/backups/export');
    if (!response.ok)
      throw new Error(((await response.json()) as { detail: string }).detail);
    const url = URL.createObjectURL(await response.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download =
      'ManualAI-backup-' + new Date().toISOString().slice(0, 10) + '.zip';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    setMessage('备份已导出，包含资料与附件，不包含 API 密钥。');
  }
  async function restore(file: File) {
    if (
      !window.confirm(
        '恢复备份会切换到备份中的资料库，当前资料库会完整保留。继续恢复？',
      )
    )
      return;
    await run(async () => {
      const fd = new FormData();
      fd.append('file', file);
      const result = await api('/backups/restore', {
        method: 'POST',
        body: fd,
      });
      setMessage(result.message);
      setDirty(false);
      await refetch();
      await refresh();
      notify('资料库恢复成功');
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">MAKE IT YOURS</div>
          <h1>
            设置与备份<span className="title-dot">.</span>
          </h1>
          <p>资料留在本机，AI 服务由你选择。</p>
        </div>
      </div>
      <InteractionSettings />
      <ClassificationSettings key={data?.data_dir || 'loading'} refresh={refresh}/>
      {settingsError && (
        <ErrorFeedback
          message={settingsError.message}
          onRetry={() => void refetch()}
        />
      )}
      <div className="notice" style={{ marginBottom: 20 }}>
        AI 是可选能力。只有在说明书中开启云端 AI
        后，正文才会发送至所配置的服务。自动识别与分类只需对话模型；向量模型是可选的语义检索能力。
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run(save);
        }}
      >
        {[
          ['chat', '对话模型', '用于自动识别、分类、问答与摘要'],
          ['embedding', '向量模型', '用于语义索引，可与对话模型使用不同服务'],
        ].map(([kind, name, description]) => (
          <section className="panel" key={kind}>
            <h2>{name}</h2>
            {kind === 'chat' && <Button type="button" variant="outline" disabled={busy} onClick={() => {setDirty(true);setForm({...form,chat_base:'https://api.deepseek.com',chat_model:'deepseek-v4-flash',chat_key:''});}}>使用 DeepSeek 配置</Button>}
            <p className="muted">{description} · OpenAI 兼容接口</p>
            <div className="field-row">
              <label className="field">
                API 基础地址
                <Input
                  type="url"
                  value={form[kind + '_base'] || ''}
                  onChange={(e) => field(kind + '_base', e.target.value)}
                  placeholder="https://你的服务地址/v1"
                />
              </label>
              <label className="field">
                模型名称
                <Input
                  value={form[kind + '_model'] || ''}
                  onChange={(e) => field(kind + '_model', e.target.value)}
                  placeholder="填写服务商提供的模型 ID"
                />
              </label>
            </div>
            <label className="field">
              API 密钥{' '}
              {data?.[kind + '_key_set'] ? '· 已设置，留空保留现有密钥' : ''}
              <Input
                type="password"
                autoComplete="new-password"
                value={form[kind + '_key'] || ''}
                onChange={(e) => field(kind + '_key', e.target.value)}
                placeholder="仅在本机加密保存"
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await save();
                  const r = await post('/settings/test/' + kind);
                  setMessage(r.message);
                })
              }
            >
              保存并测试连接
            </Button>
          </section>
        ))}
        <section className="panel">
          <h2>Word 转换组件</h2>
          <p className="muted">
            .docx 可直接解析；旧版 .doc 使用 LibreOffice 在本机转换。
          </p>
          <label className="field">
            soffice.exe 路径
            <Input
              value={form.libreoffice_path || ''}
              onChange={(e) => field('libreoffice_path', e.target.value)}
              placeholder="留空自动检测标准安装位置"
            />
          </label>
          <p className="muted">
            {data?.libreoffice
              ? '✓ 已检测到 LibreOffice'
              : '尚未检测到 LibreOffice，请手动安装后填入 soffice.exe 路径。'}
          </p>
        </section>
        <Button type="submit" disabled={busy}>
          {busy ? '处理中…' : '保存设置'}
        </Button>
      </form>
      <section className="panel" style={{ marginTop: 25 }}>
        <h2>本地资料与备份</h2>
        <p className="muted">资料目录</p>
        <p
          className="mono"
          style={{ wordBreak: 'break-all', margin: '12px 0 20px' }}
        >
          {data?.data_dir || '读取中…'}
        </p>
        <div className="toolbar">
          <Button variant="outline" disabled={busy} onClick={() => run(backup)}>
            <Download />
            导出完整备份
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => restoreInput.current?.click()}
          >
            <Upload />
            恢复备份
          </Button>
          <input
            ref={restoreInput}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            aria-label="选择备份"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(file);
              e.target.value = '';
            }}
          />
        </div>
        <p className="muted" style={{ marginTop: 16 }}>
          请等待导入与 AI
          索引完成后备份。恢复前校验完整性，旧资料库会保留；备份恢复上限为压缩后
          1 GB、解压后 2 GB。
        </p>
      </section>
      {message && (
        <p role="status" className="notice">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </>
  );
}
