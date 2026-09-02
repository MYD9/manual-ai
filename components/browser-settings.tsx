import { useState } from 'react';
import { Button } from './ui/button';
import { InteractionSettings, ErrorFeedback } from './tactile';
import { exportBrowserLibrary, restoreBrowserLibrary } from '@/lib/browser-library';

export default function BrowserSettings({ notify, refresh }: { notify: (message: string) => void; refresh: () => Promise<void> }) {
  const [error, setError] = useState('');
  const [backup, setBackup] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  function download() {
    setError('');
    try {
      const url = URL.createObjectURL(new Blob([exportBrowserLibrary()], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = 'manual-ai-browser-backup.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      notify('已导出浏览器资料备份');
    } catch (e) { setError((e as Error).message); }
  }
  async function restore() {
    if (!backup) return;
    setBusy(true); setError('');
    try {
      if (backup.size > 4000000) throw new Error('备份过大，请使用本地完整版。');
      restoreBrowserLibrary(await backup.text()); await refresh(); setBackup(null); notify('已恢复浏览器资料');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <section className="panel pages-settings">
    <h2>你的资料，保存在你的浏览器</h2>
    <p>公开网页不包含作者的说明书、附件、对话或密钥。你创建的内容只保存在当前浏览器，不会上传到 GitHub。清除站点数据、使用隐私窗口或更换设备会影响资料保留，请定期导出备份。</p>
    <Button onClick={download}>导出浏览器资料</Button>
    <label className="field">恢复浏览器版 JSON 备份<input type="file" accept=".json,application/json" disabled={busy} onChange={e => setBackup(e.target.files?.[0] || null)} /></label>
    {backup && <div className="notice"><p>恢复「{backup.name}」将替换当前浏览器中的资料。建议先导出当前备份。</p><div className="toolbar"><Button disabled={busy} onClick={restore}>确认替换并恢复</Button><Button variant="ghost" disabled={busy} onClick={() => setBackup(null)}>取消</Button></div></div>}
    {error && <ErrorFeedback message={error} onRetry={() => setError('')} />}
    <h2>AI 和原始附件处理</h2>
    <p>GitHub Pages 不运行 Python 后端。浏览器版支持手动编辑、TXT / Markdown 导入、关键词搜索、章节排序、收藏和回收站；AI、向量检索、PDF / Word / 图片解析需要本地完整版。这里没有 API Key 输入框，也不会调用模型服务。</p>
    <a className="source-link" href="https://github.com/MYD9/manual-ai#本地完整版" target="_blank" rel="noreferrer">查看本地安装方法 ↗</a>
    <InteractionSettings />
  </section>;
}
