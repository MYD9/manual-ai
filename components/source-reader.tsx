'use client';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ErrorFeedback, LoadingCards } from '@/components/tactile';
import { Download, StickyNote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { api, Entry } from '@/lib/api';
import PDFReader from '@/components/pdf-reader';

export default function SourceReader({
  id,
  locator,
  onClose,
  onClip,
}: {
  id: string;
  locator?: Record<string, any>;
  onClose: () => void;
  onClip: (source: Entry, block: any) => void;
}) {
  const {
    data: source,
    error,
    refetch,
    isLoading,
  } = useQuery({
    queryKey: ['source', id],
    queryFn: () => api<Entry>('/entries/' + id),
  });
  const [editing, setEditing] = useState<number | null>(null),
    [correction, setCorrection] = useState(''),
    [saving, setSaving] = useState(false),
    [saveError, setSaveError] = useState('');
  const [tab, setTab] = useState('original');
  useEffect(() => {
    if (locator?.block && !locator?.page) setTab('text');
  }, [locator]);
  useEffect(() => {
    if (tab === 'text' && source && locator?.block)
      setTimeout(
        () =>
          document
            .getElementById('block-' + locator.block)
            ?.scrollIntoView({ block: 'center' }),
        80,
      );
  }, [source, tab, locator]);
  async function saveCorrection() {
    if (!source || editing === null) return;
    setSaving(true);
    setSaveError('');
    try {
      await api('/sources/' + id + '/text', {
        method: 'PATCH',
        body: JSON.stringify({
          revision: source.revision,
          block: editing,
          text: correction,
        }),
      });
      setEditing(null);
      await refetch();
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  const url = source?.attrs.hash ? '/api/v1/blobs/' + source.attrs.hash : '';
  const isPDF = source?.attrs.mime === 'application/pdf';
  const isImage = source?.attrs.mime?.startsWith('image/');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="dialog-wide source-reader">
        <DialogTitle>{source?.title || '资料原文'}</DialogTitle>
        <DialogDescription>
          原始资料与识别正文分开保存。可把需要的片段收藏为知识卡片。
        </DialogDescription>
        {isLoading && <LoadingCards label="正在加载原始资料" />}
        {error && (
          <ErrorFeedback
            message={error.message}
            onRetry={() => void refetch()}
          />
        )}
        {source && (
          <>
            <div className="toolbar">
              {(isPDF || isImage) && (
                <>
                  <Button
                    variant={tab === 'original' ? 'secondary' : 'ghost'}
                    onClick={() => setTab('original')}
                  >
                    原始资料
                  </Button>
                  <Button
                    variant={tab === 'text' ? 'secondary' : 'ghost'}
                    onClick={() => setTab('text')}
                  >
                    识别正文
                  </Button>
                </>
              )}
              {url && (
                <a
                  href={url}
                  download={source.attrs.filename || 'source.txt'}
                  className="source-link"
                >
                  <Download size={14} />
                  下载原件
                </a>
              )}
            </div>
            {tab === 'original' && isPDF ? (
              <PDFReader key={url} url={url} initialPage={locator?.page || 1} />
            ) : tab === 'original' && isImage ? (
              <div
                style={{
                  position: 'relative',
                  width: 'fit-content',
                  maxWidth: '100%',
                  margin: 'auto',
                }}
              >
                <img src={url} alt={source.title} />
                {locator?.boxes && locator.width && (
                  <svg
                    viewBox={'0 0 ' + locator.width + ' ' + locator.height}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      width: '100%',
                      height: '100%',
                      pointerEvents: 'none',
                    }}
                    aria-label="OCR 来源区域"
                  >
                    {locator.boxes.map((box: number[][], i: number) => (
                      <polygon
                        key={i}
                        points={box.map((p) => p.join(',')).join(' ')}
                        fill="#d4df7444"
                        stroke="#88953a"
                        strokeWidth="2"
                      />
                    ))}
                  </svg>
                )}
              </div>
            ) : (
              <div>
                {source.attrs.url && (
                  <a
                    className="source-link"
                    href={source.attrs.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开来源网页
                  </a>
                )}
                {source.attrs.blocks?.map((block: any, i: number) => (
                  <section
                    id={'block-' + (i + 1)}
                    key={i}
                    className={
                      'source-block ' +
                      (locator?.block === i + 1 ? 'target' : '')
                    }
                  >
                    <div className="card-top">
                      <span>
                        {block.locator?.page
                          ? '第 ' + block.locator.page + ' 页'
                          : '段落 ' + (i + 1)}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onClip(source, block)}
                      >
                        <StickyNote />
                        收为卡片
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(i);
                          setCorrection(block.text);
                          setSaveError('');
                        }}
                      >
                        校正正文
                      </Button>
                    </div>
                    {editing === i ? (
                      <>
                        <textarea
                          aria-label="校正后的正文"
                          className="input"
                          rows={8}
                          style={{ width: '100%' }}
                          value={correction}
                          onChange={(e) => setCorrection(e.target.value)}
                        />
                        {saveError && <p className="error">{saveError}</p>}
                        <div className="toolbar">
                          <Button
                            disabled={saving || !correction.trim()}
                            onClick={saveCorrection}
                          >
                            保存校正
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={saving}
                            onClick={() => setEditing(null)}
                          >
                            取消
                          </Button>
                        </div>
                      </>
                    ) : (
                      block.text
                    )}
                    {block.corrected && (
                      <p className="muted">已人工校正 · 原件保留</p>
                    )}
                  </section>
                ))}
                {!source.attrs.blocks?.length && (
                  <p className="empty">
                    正文还在处理中；可在导入中心查看进度。
                  </p>
                )}
                {source.attrs.images?.map((im: any) => (
                  <img
                    key={im.hash}
                    src={'/api/v1/blobs/' + im.hash}
                    alt="Word 内嵌图片"
                    style={{ marginTop: 20 }}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
