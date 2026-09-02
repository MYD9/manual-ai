'use client';
import { useEffect, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  defaultDropAnimationSideEffects,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useReducedMotion } from 'motion/react';
import {
  CircleHelp,
  MoveVertical,
  Edit3,
  GripVertical,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle, PopoverDescription } from '@/components/ui/popover';
import type { Entry } from '@/lib/api';
import { attract, resist, tokens, cssEase } from '@/lib/motion';
import { ErrorFeedback, useHaptic } from '@/components/tactile';

type Props = {
  chapters: Entry[];
  selected: string;
  onSelect: (id: string) => void;
  onEdit: (entry: Entry) => void;
  onRemove: (entry: Entry) => void;
  onReorder: (items: Entry[]) => Promise<void>;
};
export default function ChapterList(props: Props) {
  const { chapters, selected, onSelect, onEdit, onRemove, onReorder } = props;
  const [items, setItems] = useState(chapters),
    [activeId, setActiveId] = useState<string | null>(null),
    [overId, setOverId] = useState<string | null>(null),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState(
    '',
  );
  const [helpOpen, setHelpOpen] = useState(false), [moveId, setMoveId] = useState(''), [movePosition, setMovePosition] = useState('1');
  const list = useRef<HTMLDivElement>(null),
    busy = useRef(false),
    validDrop = useRef(false);
  const latest = useRef(chapters);
  latest.current = chapters;
  const retry = useRef<string[]>([]);
  const reduced = useReducedMotion(),
    pulse = useHaptic();
  const curve =
    typeof document !== 'undefined' && CSSSupportsLinear()
      ? getComputedStyle(document.documentElement)
          .getPropertyValue('--spring-drag')
          .trim() || cssEase('enter')
      : cssEase('enter');
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: tokens.gesture.mouseDistance },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: tokens.gesture.touchDelay,
        tolerance: tokens.gesture.touchTolerance,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  useEffect(() => {
    if (!busy.current && !activeId) setItems(chapters);
  }, [chapters, activeId, saving]);
  async function commit(next: Entry[]) {
    if (busy.current) return;
    busy.current = true;
    setSaving(true);
    setError('');
    setItems(next);
    retry.current = next.map((e) => e.id);
    try {
      await onReorder(next);
      setAnnouncement('章节顺序已保存');
      pulse('drop');
    } catch (e) {
      setItems(latest.current);
      setError((e as Error).message + '。已恢复当前保存的顺序。');
      setAnnouncement('保存失败，顺序已恢复');
      pulse('error');
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const boundary: Modifier = ({ transform, activeNodeRect, over }) => {
    if (!list.current || !activeNodeRect) return transform;
    const bounds = list.current.getBoundingClientRect();
    const x = resist(
      transform.x,
      bounds.left - activeNodeRect.left,
      bounds.right - activeNodeRect.right,
    );
    const y = resist(
      transform.y,
      bounds.top - activeNodeRect.top,
      bounds.bottom - activeNodeRect.bottom,
    );
    return {
      ...transform,
      x,
      y: over ? attract(y, over.rect.top - activeNodeRect.top) : y,
    };
  };
  function finish(event: DragEndEvent) {
    setActiveId(null);
    setOverId(null);
    validDrop.current = Boolean(
      event.over && event.over.id !== event.active.id,
    );
    if (!validDrop.current) {
      setAnnouncement('章节已放回原位');
      return;
    }
    const from = items.findIndex((e) => e.id === event.active.id),
      to = items.findIndex((e) => e.id === event.over?.id);
    if (from >= 0 && to >= 0) void commit(arrayMove(items, from, to));
  }
  const picked = items.find((e) => e.id === activeId);
  return (
    <div className="chapter-sorter" aria-busy={saving}>
      <div className="chapter-sort-toolbar">
        <span><GripVertical size={14} aria-hidden="true" />拖动调整顺序</span>
        <Popover open={helpOpen} onOpenChange={open => {
          setHelpOpen(open);
          if (open) {
            const id = items.some(e => e.id === selected) ? selected : items[0]?.id || '';
            setMoveId(id); setMovePosition(String(Math.max(0, items.findIndex(e => e.id === id)) + 1));
          }
        }}>
          <PopoverTrigger render={<Button variant="ghost" size="sm" />} aria-label="查看章节排序示意" disabled={!items.length}><CircleHelp size={14} />示意</PopoverTrigger>
          <PopoverContent align="start" side="right" className="chapter-sort-help">
            <PopoverTitle>怎样调整章节顺序</PopoverTitle>
            <PopoverDescription>按住章节上的“拖动”，移到目标位置后松开。</PopoverDescription>
            <div className="sort-example" role="img" aria-label="拖动章节 B，将它放到章节 A 前面">
              <div className="sort-example-target">放到这里</div>
              <div className="sort-example-row"><GripVertical size={14} />章节 A</div>
              <div className="sort-example-row sort-example-picked"><GripVertical size={14} />章节 B<MoveVertical size={15} /></div>
            </div>
            <ul className="sort-instructions">
              <li>鼠标：按住“拖动”，上下移动。</li>
              <li>触屏：长按“拖动”后移动。</li>
              <li>键盘：聚焦“拖动”，空格拿起，上下键移动，空格放下，Esc 取消。</li>
            </ul>
            <form className="sort-position-form" onSubmit={event => {
              event.preventDefault();
              const from = items.findIndex(e => e.id === moveId), to = Number(movePosition) - 1;
              if (from >= 0 && Number.isInteger(to) && to >= 0 && to < items.length && from !== to) void commit(arrayMove(items, from, to));
            }}>
              <strong>也可以直接选择位置</strong>
              <label className="field">章节<select value={moveId} disabled={saving} onChange={event => {
                setMoveId(event.target.value); setMovePosition(String(items.findIndex(e => e.id === event.target.value) + 1));
              }}>{items.map(e => <option key={e.id} value={e.id}>{e.title}</option>)}</select></label>
              <label className="field">移动到<select value={movePosition} disabled={saving} onChange={event => setMovePosition(event.target.value)}>{items.map((e, i) => <option key={e.id} value={String(i + 1)}>第 {i + 1} 位</option>)}</select></label>
              <Button type="submit" disabled={saving || !moveId || items.findIndex(e => e.id === moveId) === Number(movePosition) - 1}>{saving ? '正在保存…' : '移动到此位置'}</Button>
              {(saving || announcement) && <p className="muted">{saving ? '正在保存顺序…' : announcement}</p>}
            </form>
          </PopoverContent>
        </Popover>
      </div>
      <DndContext
        sensors={sensors}
        modifiers={[boundary]}
        collisionDetection={(args) => {
          const point = args.pointerCoordinates,
            bounds = list.current?.getBoundingClientRect();
          if (
            point &&
            bounds &&
            (point.x < bounds.left ||
              point.x > bounds.right ||
              point.y < bounds.top ||
              point.y > bounds.bottom)
          )
            return [];
          return closestCenter(args);
        }}
        accessibility={{
          screenReaderInstructions: {
            draggable:
              '按空格拿起章节，使用上下方向键排序，空格放下，Escape 取消。',
          },
          announcements: {
            onDragStart: ({ active }) =>
              `已拿起章节 ${items.find((e) => e.id === active.id)?.title}`,
            onDragOver: ({ over }) =>
              over
                ? `目标位置 ${items.findIndex((e) => e.id === over.id) + 1}`
                : '已离开有效区域，松开后放回原位',
            onDragEnd: ({ over }) =>
              over ? '章节已落位，正在保存' : '已返回原位',
            onDragCancel: () => '已取消拖动',
          },
        }}
        onDragStart={(event) => {
          setActiveId(String(event.active.id));
          pulse('hold');
        }}
        onDragOver={(event) => {
          const next = event.over ? String(event.over.id) : null;
          if (next && next !== overId) pulse('snap');
          setOverId(next);
        }}
        onDragCancel={() => {
          validDrop.current = false;
          setActiveId(null);
          setOverId(null);
          setAnnouncement('已取消拖动');
        }}
        onDragEnd={finish}
      >
        <SortableContext
          items={items.map((e) => e.id)}
          strategy={verticalListSortingStrategy}
        >
          <div className="chapter-list" ref={list}>
            {items.map((entry) => (
              <SortableChapter
                key={entry.id}
                entry={entry}
                selected={selected === entry.id}
                disabled={saving}
                curve={curve}
                reduced={!!reduced}
                target={overId === entry.id && activeId !== entry.id}
                onSelect={() => onSelect(entry.id)}
                onEdit={() => onEdit(entry)}
                onRemove={() => onRemove(entry)}
              />
            ))}
          </div>
        </SortableContext>
        <DragOverlay
          dropAnimation={
            reduced
              ? null
              : {
                  duration: tokens.duration.slow,
                  easing: curve,
                  sideEffects: defaultDropAnimationSideEffects({
                    styles: { active: { opacity: '0' } },
                  }),
                  keyframes: ({ transform: { initial, final } }) => {
                    return [
                      { transform: CSS.Transform.toString(initial) },
                      { transform: CSS.Transform.toString(final) },
                    ];
                  },
                }
          }
        >
          {picked ? (
            <div
              className="chapter-row chapter-picked"
              aria-hidden="true"
              style={{ scale: reduced ? 1 : tokens.scale.pickup }}
            >
              <span className="chapter-title">{picked.title}</span>
              <span className="drag-handle"><GripVertical size={14} />拖动</span>
              <span className="icon-btn"><Edit3 /></span>
              <span className="icon-btn"><Trash2 /></span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      <p className="sort-status" role="status">
        {saving ? '正在保存顺序…' : announcement}
      </p>
      {error && (
        <ErrorFeedback
          message={error}
          busy={saving}
          onRetry={() => {
            const fresh = retry.current
              .map((id) => latest.current.find((e) => e.id === id))
              .filter((e): e is Entry => !!e);
            void commit([
              ...fresh,
              ...latest.current.filter((e) => !retry.current.includes(e.id)),
            ]);
          }}
        />
      )}
    </div>
  );
}
function CSSSupportsLinear() {
  return window.CSS?.supports('transition-timing-function', 'linear(0, 1)');
}
type RowProps = {
  entry: Entry;
  selected: boolean;
  disabled: boolean;
  curve: string;
  reduced: boolean;
  target: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
};
function SortableChapter({
  entry,
  selected,
  disabled,
  curve,
  reduced,
  target,
  onSelect,
  onEdit,
  onRemove,
}: RowProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: entry.id,
    disabled,
    transition: {
      duration: reduced ? 0 : tokens.duration.normal,
      easing: curve,
    },
  });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={
        'chapter-row ' +
        (selected ? 'active ' : '') +
        (isDragging ? 'chapter-dragging ' : '') +
        (target ? 'chapter-drop-target' : '')
      }
    >
      <button className="chapter-title" aria-pressed={selected} onClick={onSelect} title={entry.title}>
        {entry.title}
      </button>
      <button
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        className="drag-handle"
        aria-label={'拖动章节：' + entry.title}
        title="按住拖动排序；触屏长按，键盘按空格开始"
        disabled={disabled}
      >
        <GripVertical size={14} aria-hidden="true" />拖动
      </button>
      <button
        className="icon-btn"
        aria-label="编辑章节"
        onClick={onEdit}
        disabled={disabled}
      >
        <Edit3 />
      </button>
      <button
        className="icon-btn"
        aria-label="删除章节"
        onClick={onRemove}
        disabled={disabled}
      >
        <Trash2 />
      </button>
    </div>
  );
}
