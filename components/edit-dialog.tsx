'use client';
import { browserEdition } from '@/lib/edition';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import RichEditor from '@/components/rich-editor';
import type { Entry } from '@/lib/api';
import type { EditSpec } from '@/components/manual-app';

export default function EditDialog({
  spec,
  manuals,
  categories,
  chapters,
  onClose,
  onSave,
}: {
  spec: EditSpec;
  manuals: Entry[];
  categories: string[];
  chapters: Entry[];
  onClose: () => void;
  onSave: (value: any, extra?: { mergeTarget?: string }) => Promise<void>;
}) {
  const e = spec.entry,
    kind = spec.kind;
  const [title, setTitle] = useState(e?.title || ''),
    [content, setContent] = useState(e?.content || spec.content || ''),
    [category, setCategory] = useState(e?.category || ''),
    [tags, setTags] = useState(e?.tags.join(', ') || ''),
    [color, setColor] = useState(e?.color || 'yellow'),
    [mid, setMid] = useState(
      e?.manual_id || spec.manual_id || manuals[0]?.id || '',
    ),
    [parent, setParent] = useState(e?.parent_id || spec.parent_id || ''),
    [brand, setBrand] = useState(e?.attrs.brand || ''),
    [model, setModel] = useState(e?.attrs.model || ''),
    [device, setDevice] = useState(e?.attrs.device || ''),
    [enabled, setEnabled] = useState(!!e?.attrs.ai_enabled),
    [mergeTarget, setMergeTarget] = useState('');
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [draft, setDraft] = useState<any>(null),
    [dirty, setDirty] = useState(false);
  const draftKey =
    'manual-ai-draft-' + (e?.id || kind + '-' + (spec.manual_id || ''));
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) setDraft(JSON.parse(raw));
    } catch {}
  }, [draftKey]);
  const draftData = {
    title,
    content,
    category,
    tags,
    color,
    mid,
    parent,
    brand,
    model,
    device,
    enabled,
    revision: e?.revision,
  };
  useEffect(() => {
    if (!dirty) return;
    const id = setTimeout(() => {
      try {
        localStorage.setItem(draftKey, JSON.stringify(draftData));
      } catch {}
    }, 400);
    return () => clearTimeout(id);
  }, [
    title,
    content,
    category,
    tags,
    color,
    mid,
    parent,
    brand,
    model,
    device,
    enabled,
    dirty,
    draftKey,
  ]);
  function restoreDraft() {
    setTitle(draft.title);
    setContent(draft.content);
    setCategory(draft.category);
    setTags(draft.tags);
    setColor(draft.color);
    setMid(draft.mid);
    setParent(draft.parent);
    setBrand(draft.brand);
    setModel(draft.model);
    setDevice(draft.device);
    setEnabled(draft.enabled);
    setDraft(null);
    setDirty(true);
  }
  function close() {
    if (dirty)
      try {
        localStorage.setItem(draftKey, JSON.stringify(draftData));
      } catch {}
    onClose();
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      const value: any = {
        title: title.trim(),
        content,
        category,
        tags: Array.from(
          new Set(
            tags
              .split(/[,，#]/)
              .map((t) => t.trim())
              .filter(Boolean),
          ),
        ),
        color,
        attrs:
          kind === 'manual'
            ? { brand, model, device, ai_enabled: enabled }
            : spec.attrs || {},
      };
      if (!e) {
        value.kind = kind;
        if (!['manual', 'category'].includes(kind)) {
          value.manual_id = mid;
          value.parent_id = parent || null;
        }
      } else if (['card', 'note', 'chapter'].includes(kind)) {
        if (mid !== e.manual_id) value.manual_id = mid;
        if (kind !== 'chapter') value.parent_id = parent || null;
      }
      await onSave(value, { mergeTarget: mergeTarget || undefined });
      localStorage.removeItem(draftKey);
    } catch (err) {
      setError((err as Error).message);
      try {
        localStorage.setItem(draftKey, JSON.stringify(draftData));
      } catch {}
    } finally {
      setBusy(false);
    }
  }
  const label = (
    {
      manual: '说明书',
      chapter: '章节',
      card: '知识卡片',
      note: '经验笔记',
      category: '分类',
    } as Record<string, string>
  )[kind];
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent className="dialog-wide">
        <DialogTitle>
          {e ? '编辑' : '新建'}
          {label}
        </DialogTitle>
        <DialogDescription>
          {kind === 'manual'
            ? '给资料一个名字，把相关的知识慢慢收进来。'
            : '保存前可以自由编辑。关闭窗口时，未保存的草稿会留在此浏览器。'}
        </DialogDescription>
        <form
          onSubmit={submit}
          onChange={() => setDirty(true)}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              if (!busy && title.trim()) event.currentTarget.requestSubmit();
            }
          }}
        >
          {draft && (
            <div className="notice">
              发现未保存的草稿。
              {e &&
                draft.revision !== e.revision &&
                '资料已有新版本，请合并核对。'}
              <Button type="button" variant="ghost" onClick={restoreDraft}>
                恢复草稿
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft(null);
                  localStorage.removeItem(draftKey);
                }}
              >
                忽略
              </Button>
            </div>
          )}
          <label className="field">
            {label}名称
            <Input
              autoFocus
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                kind === 'manual'
                  ? '例如：ESP32-S3 开发板'
                  : '给这条内容起个名字'
              }
            />
          </label>
          {kind === 'manual' && (
            <>
              <div className="field-row">
                <label className="field">
                  品牌
                  <Input
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="例如：Espressif"
                  />
                </label>
                <label className="field">
                  型号
                  <Input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="例如：ESP32-S3"
                  />
                </label>
              </div>
              <label className="field">
                设备 / 项目
                <Input
                  value={device}
                  onChange={(e) => setDevice(e.target.value)}
                  placeholder="例如：桌面机器人"
                />
              </label>
              <label className="field">
                分类
                <Input
                  list="manual-categories"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  placeholder="选择或输入新分类"
                />
                <datalist id="manual-categories">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                简短介绍
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="这本说明书中有哪些内容？"
                />
              </label>
            </>
          )}
          {!['manual', 'category'].includes(kind) && (
            <div className="field-row">
              <label className="field">
                所属说明书
                <select
                  value={mid}
                  onChange={(e) => {
                    setMid(e.target.value);
                    setParent('');
                  }}
                  required
                >
                  {manuals.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.title}
                    </option>
                  ))}
                </select>
              </label>
              {kind !== 'chapter' && (
                <label className="field">
                  所属章节
                  <select
                    value={parent}
                    onChange={(e) => setParent(e.target.value)}
                  >
                    <option value="">未归入章节</option>
                    {chapters
                      .filter((c) => c.manual_id === mid)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                  </select>
                </label>
              )}
            </div>
          )}
          {['card', 'note'].includes(kind) && (
            <div className="field">
              <span>正文</span>
              <RichEditor
                value={content}
                onChange={(value) => {
                  setContent(value);
                  setDirty(true);
                }}
              />
            </div>
          )}
          {['manual', 'card', 'note'].includes(kind) && (
            <label className="field">
              标签
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="用逗号分隔，例如：UART, WiFi, 调试"
              />
            </label>
          )}
          {kind === 'manual' && (
            <>
              <div className="field">
                <span>便签颜色</span>
                <div className="color-picker">
                  {['yellow', 'blue', 'green', 'pink', 'purple', 'white'].map(
                    (c, i) => (
                      <button
                        key={c}
                        aria-label={
                          ['麦黄', '雾蓝', '鼠尾草', '浅桃', '淡紫', '暖白'][i]
                        }
                        type="button"
                        aria-pressed={color === c}
                        className={
                          'color-swatch note-' +
                          c +
                          (color === c ? ' selected' : '')
                        }
                        onClick={() => {
                          setColor(c);
                          setDirty(true);
                        }}
                      />
                    ),
                  )}
                </div>
              </div>
              <label className="checkbox-line">
                <Checkbox
                  disabled={browserEdition} checked={!browserEdition && enabled}
                  onCheckedChange={(value) => {
                    setEnabled(value);
                    setDirty(true);
                  }}
                />
                开启这本说明书的云端 AI
              </label>
              <p className="muted">
                开启后，资料正文可发送到你配置的对话服务用于识别、分类和问答；
                配置向量服务时可建立语义索引。原始附件保存在本机。
              </p>
            </>
          )}
          {kind === 'chapter' && e && (
            <label className="field">
              合并到另一章节（可选）
              <select
                value={mergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
              >
                <option value="">不合并</option>
                {chapters
                  .filter((c) => c.manual_id === e.manual_id && c.id !== e.id)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
              </select>
              <span className="muted">
                合并会移动卡片，当前章节进入回收站。
              </span>
            </label>
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <div
            className="toolbar"
            style={{ justifyContent: 'flex-end', marginTop: 22 }}
          >
            <span className="save-state">
              {busy ? '正在保存…' : dirty ? '未保存 · 草稿保留在浏览器' : ''}
            </span>
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={busy}
            >
              关闭
            </Button>
            <Button
              type="submit"
              title="保存 · Ctrl+Enter"
              aria-keyshortcuts="Control+Enter Meta+Enter"
              disabled={busy || !title.trim()}
            >
              {busy ? '保存中…' : mergeTarget ? '合并章节' : '保存' + label}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
