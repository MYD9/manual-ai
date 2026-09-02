'use client';
import {
  Children,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from 'motion/react';
import { Check, RefreshCw } from 'lucide-react';
import { tokens, spring, tween } from '@/lib/motion';
import { Switch } from '@/components/ui/switch';

type Haptic = keyof typeof tokens.haptic;
const Preferences = createContext({
  enabled: false,
  supported: false,
  setEnabled: (_: boolean) => {},
  pulse: (_: Haptic) => {},
});
export function TactileProvider({ children }: { children: ReactNode }) {
  const [enabled, setEnabled] = useState(false),
    [supported, setSupported] = useState(false);
  const last = useRef(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    setSupported(
      'vibrate' in navigator && matchMedia('(pointer: coarse)').matches,
    );
    try {
      setEnabled(localStorage.getItem('manual-ai:haptic') === 'on');
    } catch {}
  }, []);
  function update(value: boolean) {
    setEnabled(value);
    try {
      localStorage.setItem('manual-ai:haptic', value ? 'on' : 'off');
    } catch {}
  }
  function pulse(kind: Haptic) {
    if (
      !enabled ||
      !supported ||
      reduced ||
      performance.now() - last.current < tokens.timing.hapticCooldown
    )
      return;
    try {
      navigator.vibrate(tokens.haptic[kind]);
      last.current = performance.now();
    } catch {}
  }
  return (
    <Preferences.Provider
      value={{ enabled, supported, setEnabled: update, pulse }}
    >
      <MotionConfig reducedMotion="user" transition={spring('soft')}>
        {children}
      </MotionConfig>
    </Preferences.Provider>
  );
}
export const useHaptic = () => useContext(Preferences).pulse;
export function InteractionSettings() {
  const { enabled, supported, setEnabled } = useContext(Preferences);
  const reduced = useReducedMotion();
  return (
    <div className="panel interaction-settings">
      <h2>操作反馈</h2>
      <label className="preference-row">
        <span>
          关键操作触感
          <small>在触屏设备上，拖拽完成、成功和错误可给予短促振动。</small>
        </span>
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-label="关键操作触感"
          disabled={!supported}
        />
      </label>
      <p className="muted">
        {!supported
          ? '此浏览器未提供可用的触屏振动支持。'
          : enabled
            ? '已开启，仅用于明确的操作结果。'
            : '默认关闭，可按需开启。'}
        {reduced
          ? ' 当前跟随系统减少动态效果，同时暂停振动。'
          : ' 动效自动跟随系统“减少动态效果”设置。'}
      </p>
    </div>
  );
}
/** Stable keyed children preserve DOM identity through filtering, deletion and reordering. */
export function ReflowList({
  children,
  className = '',
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  const reduced = useReducedMotion();
  return (
    <div className={'reflow-list ' + className} aria-label={label}>
      <AnimatePresence initial={false} mode="sync">
        {Children.toArray(children).map((child) => {
          if (typeof child !== 'object' || !('key' in child)) return child;
          return (
            <motion.div
              key={child.key}
              layout={reduced ? false : 'position'}
              className="reflow-item"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ layout: spring('soft'), opacity: tween('fast') }}
            >
              {child}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
export function Progress({ value, label }: { value: number; label: string }) {
  const amount = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(amount)}
    >
      <span style={{ transform: `scaleX(${amount / 100})` }} />
    </div>
  );
}
export function LoadingCards({ label = '正在加载资料' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="skeleton-list">
      <span className="sr-only">{label}</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="skeleton-card" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}
export function ErrorFeedback({
  message,
  onRetry,
  busy = false,
}: {
  message: string;
  onRetry?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="error-feedback" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button disabled={busy} onClick={onRetry} className="source-link">
          <RefreshCw size={14} />
          重试
        </button>
      )}
    </div>
  );
}
export function SuccessMark() {
  return <Check className="success-mark" size={16} aria-hidden="true" />;
}
