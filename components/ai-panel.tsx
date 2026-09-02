'use client';
import { useEffect, useRef, useState } from 'react';
import { shouldSendOnEnter } from '@/lib/chat-input';
import { tokens } from '@/lib/motion';
import {
  Sparkles,
  X,
  Send,
  StickyNote,
  Settings,
  FileText,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { consumeSSE, serviceFetch, Entry, Hit } from '@/lib/api';
type Message = {
  role: string;
  text: string;
  sources?: Hit[];
  warning?: string;
};
export default function AIPanel({
  manuals,
  initial,
  onClose,
  onSource,
  onSave,
  onSettings,
}: {
  manuals: Entry[];
  initial: { manualId?: string; purpose?: string };
  onClose: () => void;
  onSource: (hit: Hit) => void;
  onSave: (text: string, mid: string) => void;
  onSettings: () => void;
}) {
  const [mid, setMid] = useState(initial.manualId || ''),
    [question, setQuestion] = useState(
      initial.purpose === 'summary'
        ? '请总结这本说明书的关键内容'
        : initial.purpose === 'organize'
          ? '请帮我整理这本说明书'
          : '',
    ),
    [messages, setMessages] = useState<Message[]>([]),
    [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState(true);
  const atBottom = useRef(true);
  const sending = useRef(false), composing = useRef(false);
  const abort = useRef<AbortController | null>(null),
    body = useRef<HTMLDivElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (body.current && atBottom.current)
      body.current.scrollTop = body.current.scrollHeight;
  }, [messages, busy]);
  async function send(event?: React.FormEvent, retryQuestion?: string) {
    event?.preventDefault();
    const query = retryQuestion ?? question;
    if (!query.trim() || sending.current) return;
    sending.current = true;
    atBottom.current = true;
    setFollowing(true);
    setQuestion('');
    setMessages((m) => [
      ...m,
      { role: 'user', text: query },
      { role: 'assistant', text: '' },
    ]);
    setBusy(true);
    abort.current = new AbortController();
    const amend = (fn: (m: Message) => Message) =>
      setMessages((items) =>
        items.map((m, i) => (i === items.length - 1 ? fn(m) : m)),
      );
    try {
      const response = await serviceFetch('/api/v1/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: query,
          manual_id: mid || undefined,
          purpose: messages.length ? 'question' : initial.purpose || 'question',
          history: messages.filter(m => m.text.trim() && !m.warning).slice(-10).map(m => ({ role: m.role, content: m.text.slice(0, 4000) })),
        }),
        signal: abort.current.signal,
      });
      await consumeSSE(response, (event, data) => {
        if (event === 'delta')
          amend((m) => ({ ...m, text: m.text + data.text }));
        if (event === 'sources') amend((m) => ({ ...m, sources: data }));
        if (event === 'warning' || event === 'error')
          amend((m) => ({ ...m, warning: data.text }));
      });
    } catch (e) {
      amend((m) => ({
        ...m,
        warning:
          (e as Error).name === 'AbortError'
            ? '已停止生成'
            : (e as Error).message,
      }));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }
  function renderText(message: Message) {
    return message.text.split(/(\[\d+\])/).map((part, i) => {
      const n = /^\[(\d+)\]$/.exec(part);
      const source = n ? message.sources?.[Number(n[1]) - 1] : null;
      return source ? (
        <button
          key={i}
          className="source-link"
          style={{ display: 'inline', margin: '0 3px', padding: '1px 5px' }}
          onClick={() => {
            onClose();
            onSource(source);
          }}
        >
          {part}
        </button>
      ) : (
        part
      );
    });
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="ai-panel"
        placement="right"
        showCloseButton={false}
      >
        <DialogDescription className="sr-only">
          查询说明书中的资料并查看回答出处
        </DialogDescription>
        <header className="ai-header">
          <DialogTitle>
            <Sparkles size={19} />
            你的资料助手
          </DialogTitle>
          <div className="toolbar">
            <button
              className="icon-btn"
              aria-label="AI 设置"
              onClick={onSettings}
            >
              <Settings />
            </button>
            <button
              className="icon-btn"
              aria-label="关闭 AI 助手"
              onClick={onClose}
            >
              <X />
            </button>
          </div>
        </header>
        <div style={{ padding: '15px 22px' }}>
          <select
            className="select"
            disabled={busy}
            value={mid}
            onChange={(e) => { setMid(e.target.value); setMessages([]); }}
            aria-label="AI 搜索范围"
          >
            <option value="">全部已启用 AI 的说明书</option>
            {manuals.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </div>
        <div
          className="ai-body"
          ref={body}
          onScroll={(event) => {
            const el = event.currentTarget;
            atBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight <
              tokens.distance.drawer;
            setFollowing(atBottom.current);
          }}
        >
          {!messages.length && (
            <>
              <div className="empty">
                <Sparkles size={30} />
                <h3>让积累的知识，回答你。</h3>
                <p>
                  试着问一个具体的问题。
                  <br />
                  回答会附上资料出处，便于随时核对。
                </p>
              </div>
              <div className="notice">
                AI
                只查询已开启 AI 的说明书。配置对话服务后即可提问；向量服务可选。支持继续追问，回答附原文出处。
              </div>
            </>
          )}
          {messages.map((m, i) => (
            <div className={'message ' + m.role} key={i}>
              <small>{m.role === 'user' ? '你' : 'Manual AI'}</small>
              {renderText(m)}
              {m.warning && (
                <div className="error-feedback" role="alert">
                  <span>{m.warning}</span>
                  {!busy && i > 0 && (
                    <button
                      className="source-link"
                      onClick={() => void send(undefined, messages[i - 1].text)}
                    >
                      重试此问题
                    </button>
                  )}
                </div>
              )}
              {m.sources && m.sources.length > 0 && (
                <div style={{ marginTop: 15 }}>
                  <span className="muted">参考资料</span>
                  {m.sources.map((s, n) => (
                    <button
                      key={s.id}
                      className="source-link"
                      style={{ display: 'flex', textAlign: 'left' }}
                      onClick={() => {
                        onClose();
                        onSource(s);
                      }}
                    >
                      <FileText size={12} />[{n + 1}] {s.title}
                      {s.locator.page ? ' · p.' + s.locator.page : ''}
                    </button>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.text && !busy && (
                <Button
                  variant="ghost"
                  style={{ marginTop: 12 }}
                  onClick={() => onSave(m.text, mid)}
                >
                  <StickyNote />
                  编辑并保存为笔记
                </Button>
              )}
            </div>
          ))}
          {busy && <p className="muted busy">正在查找和组织资料…</p>}
        </div>
        {!following && (
          <button
            className="source-link latest-message"
            onClick={() => {
              atBottom.current = true;
              setFollowing(true);
              if (body.current)
                body.current.scrollTop = body.current.scrollHeight;
            }}
          >
            回到最新回复 ↓
          </button>
        )}
        <form className="ai-compose" onSubmit={send}>
          <textarea
            aria-label="向 AI 提问"
            aria-describedby="chat-keyboard-hint"
            onCompositionStart={() => { composing.current = true; }}
            onCompositionEnd={() => { composing.current = false; }}
            onKeyDown={event => {
              if (shouldSendOnEnter({ key: event.key, shiftKey: event.shiftKey, isComposing: composing.current || event.nativeEvent.isComposing, keyCode: event.nativeEvent.keyCode })) {
                event.preventDefault();
                void send();
              }
            }}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="问一个关于资料的问题…"
          />
          <div className="toolbar" style={{ justifyContent: 'space-between' }}>
            <span className="muted" id="chat-keyboard-hint">Enter 发送 · Shift+Enter 换行</span>
            {busy ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => abort.current?.abort()}
              >
                停止生成
              </Button>
            ) : (
              <Button type="submit" disabled={!question.trim()}>
                <Send />
                发送
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
