'use client';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { tokens, spring, tween } from '@/lib/motion';
import { Info, LoaderCircle, RotateCcw, Star, X } from 'lucide-react';

export function FavoriteButton({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  return (
    <button
      className="icon-btn favorite-toggle"
      aria-label={label}
      title={label}
      aria-pressed={active}
      aria-busy={busy}
      disabled={busy}
      onClick={async (event) => {
        event.stopPropagation();
        if (pending.current) return;
        pending.current = true;
        setBusy(true);
        try {
          await onToggle();
        } finally {
          pending.current = false;
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <LoaderCircle className="spin" />
      ) : (
        <Star className={active ? 'star-on' : ''} />
      )}
    </button>
  );
}

export type Notice = {
  id: number;
  text: string;
  tone?: 'error';
  undo?: () => Promise<void>;
};

export function ActionToast({
  notice,
  onClose,
}: {
  notice: Notice;
  onClose: () => void;
}) {
  const [hovered, setHovered] = useState(false),
    [focused, setFocused] = useState(false),
    [busy, setBusy] = useState(false);
  const actionPending = useRef(false);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (hovered || focused || busy) return;
    const timer = setTimeout(
      onClose,
      notice.undo ? tokens.timing.undo : tokens.timing.toast,
    );
    return () => clearTimeout(timer);
  }, [notice, onClose, hovered, focused, busy]);
  return (
    <motion.div
      className="toast-position"
      initial={{ opacity: 0, y: reduced ? 0 : tokens.distance.enter }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 0, transition: tween('fast', 'exit') }}
      transition={spring('snappy')}
    >
      <div
        className={
          'toast action-toast ' + (notice.tone === 'error' ? 'toast-error' : '')
        }
        role="status"
        aria-live="polite"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFocused(false);
        }}
      >
        <Info size={18} aria-hidden="true" />
        <span>{notice.text}</span>
        {notice.undo && (
          <button
            className="toast-undo"
            disabled={busy}
            onClick={async () => {
              if (actionPending.current) return;
              actionPending.current = true;
              setBusy(true);
              try {
                await notice.undo!();
              } finally {
                actionPending.current = false;
                setBusy(false);
              }
            }}
          >
            {busy ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <RotateCcw size={14} />
            )}
            撤销
          </button>
        )}
        <button
          className="toast-close"
          disabled={busy}
          onClick={onClose}
          aria-label="关闭操作提示"
        >
          <X size={16} />
        </button>
      </div>
    </motion.div>
  );
}
