import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Panel width in px (default 420); never wider than the viewport minus a 16 px gutter. */
  width?: number;
  onCancel(): void;
  footer?: ReactNode;
  children?: ReactNode;
}

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Modal dialog primitive (spec multi-file-edit-diff Phase 1 "Dialog primitive"): scrim, 12 px
 * panel, focus trap (focus moves into the panel on open and returns to the previously focused
 * element on close), `Esc` cancels, `role="dialog"` + `aria-modal`, rendered in a portal on
 * `document.body`. Clicking the scrim cancels too.
 */
export function Dialog({
  open,
  title,
  subtitle,
  width = 420,
  onCancel,
  footer,
  children,
}: DialogProps) {
  const titleId = useId();
  const subtitleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(onCancel);
  useEffect(() => {
    cancelRef.current = onCancel;
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panel = panelRef.current;
    if (panel) {
      // Prefer an explicitly marked initial target, else the first focusable, else the panel.
      const initial =
        panel.querySelector<HTMLElement>('[data-autofocus]') ?? focusables(panel)[0] ?? panel;
      initial.focus();
    }
    return () => {
      if (prev && prev.isConnected) prev.focus();
    };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      cancelRef.current();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const items = focusables(panel);
    if (items.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgb(15_17_21/0.38)] px-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) cancelRef.current();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle !== undefined ? subtitleId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{ width: `min(${width}px, calc(100vw - 32px))` }}
        className="flex max-h-[calc(100vh-32px)] flex-col rounded-[12px] border border-border bg-panel text-text shadow-[0_20px_50px_rgb(0_0_0/0.25)] outline-none"
      >
        <div className="px-5 pt-5 pb-3">
          <h2 id={titleId} className="text-[15px] font-semibold text-text">
            {title}
          </h2>
          {subtitle !== undefined && (
            <p id={subtitleId} className="mt-1 text-[13px] text-muted">
              {subtitle}
            </p>
          )}
        </div>
        {children !== undefined && (
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 text-[13px]">{children}</div>
        )}
        {footer !== undefined && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
