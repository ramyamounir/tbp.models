/**
 * Toast primitive (spec multi-file-edit-diff Phase 3a "Toast primitive"): a module-level single
 * slot that `showToast` writes and `<ToastHost />` (mounted once in App) reads through
 * `useSyncExternalStore`, so any module can show a toast without React context.
 *
 * One toast at a time; a new one replaces the current one and restarts the 5 s timer (hovering
 * does not pause it). The text is file-derived and is rendered only as a React text child.
 */
import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

export interface ToastInput {
  text: string;
  action?: { label: string; run(): void };
}

interface ToastState extends ToastInput {
  id: number;
}

export const TOAST_LIFETIME_MS = 5000;

let current: ToastState | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

const getSnapshot = () => current;
const getServerSnapshot = () => null;

// eslint-disable-next-line react-refresh/only-export-components -- spec API (Phase 3a)
export function showToast(t: ToastInput): void {
  if (timer !== undefined) clearTimeout(timer);
  const id = ++seq;
  current = { text: t.text, action: t.action, id };
  timer = setTimeout(() => dismiss(id), TOAST_LIFETIME_MS);
  emit();
}

/** Dismisses the toast with `id` (or the current one); a newer toast is left alone. */
// eslint-disable-next-line react-refresh/only-export-components -- spec API (Phase 3a)
export function dismissToast(id?: number): void {
  dismiss(id ?? current?.id);
}

function dismiss(id: number | undefined): void {
  if (current === null || id !== current.id) return;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  current = null;
  emit();
}

function CloseIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function ToastHost() {
  const t = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-5 z-[120] flex justify-center px-4"
    >
      {t && (
        <div
          key={t.id}
          className="pointer-events-auto flex max-w-[min(560px,100%)] min-w-0 items-center gap-3 rounded-[8px] bg-[#16181d] py-2 pr-2 pl-3.5 text-[13px] text-white shadow-[0_10px_30px_rgb(0_0_0/0.18)]"
        >
          <span className="bidi-isolate min-w-0 flex-1 break-words" dir="auto">
            {t.text}
          </span>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                const run = t.action!.run;
                dismiss(t.id);
                run();
              }}
              className="shrink-0 rounded px-2 py-1 text-[13px] font-semibold text-[#93b4ff] hover:bg-white/10"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismiss(t.id)}
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-white/70 hover:bg-white/10 hover:text-white"
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}
