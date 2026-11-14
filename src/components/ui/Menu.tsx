/**
 * Popover menu primitive (spec multi-file-edit-diff Phase 3a "Menu primitive"): items with icon,
 * label, shortcut hint, `danger`, `disabled`, separators and one level of submenu. Closes on
 * `Esc`, `Tab`, outside click, scroll / resize and item activation; `↑` / `↓` move, `→` opens a
 * submenu, `←` closes it. Rendered in a portal on `document.body` at an anchor element (below it)
 * or a point (right-click), flipped to stay inside the viewport.
 *
 * Labels can be file-derived: they are rendered as React children only (never as HTML).
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export type MenuItem =
  | {
      kind: 'item';
      id: string;
      label: ReactNode;
      icon?: ReactNode;
      shortcut?: string;
      danger?: boolean;
      disabled?: boolean;
      title?: string;
      onSelect?: () => void;
      submenu?: MenuItem[];
    }
  | { kind: 'separator'; id: string };

export type MenuAnchor = HTMLElement | { x: number; y: number };

export interface MenuProps {
  items: MenuItem[];
  anchor: MenuAnchor;
  onClose(): void;
  /**
   * Placement next to an anchor element: 'below' (default) or 'right' (cascade: right of the
   * anchor, top edges aligned). Ignored for a point anchor.
   */
  placement?: 'below' | 'right';
  /** Width of the root panel in px (default `MENU_WIDTH`). */
  width?: number;
}

export const MENU_WIDTH = 236;
const GAP = 4;
const MARGIN = 8;

type Item = Extract<MenuItem, { kind: 'item' }>;

const isEnabled = (it: MenuItem): it is Item => it.kind === 'item' && !it.disabled;

function ChevronRight() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Top-left of a `w` × `h` panel placed at `anchor`, flipped / clamped into the viewport. */
function place(
  anchor: Rect | { x: number; y: number },
  w: number,
  h: number,
  mode: 'below' | 'right',
): { left: number; top: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left: number;
  let top: number;
  if ('x' in anchor) {
    left = anchor.x + w > vw - MARGIN ? anchor.x - w : anchor.x;
    top = anchor.y + h > vh - MARGIN ? anchor.y - h : anchor.y;
  } else if (mode === 'right') {
    left = anchor.right + w + GAP > vw - MARGIN ? anchor.left - w - GAP : anchor.right + GAP;
    top = anchor.top + h > vh - MARGIN ? anchor.bottom - h : anchor.top;
  } else {
    left = anchor.left + w > vw - MARGIN ? anchor.right - w : anchor.left;
    top =
      anchor.bottom + GAP + h > vh - MARGIN && anchor.top - GAP - h >= MARGIN
        ? anchor.top - GAP - h
        : anchor.bottom + GAP;
  }
  left = Math.max(MARGIN, Math.min(left, vw - MARGIN - w));
  top = Math.max(MARGIN, Math.min(top, vh - MARGIN - h));
  return { left, top };
}

function anchorRect(anchor: MenuAnchor): Rect | { x: number; y: number } {
  if (!(anchor instanceof HTMLElement)) return anchor;
  const r = anchor.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** One menu panel (the root list or the open submenu). */
function Panel({
  items,
  anchor,
  mode,
  width = MENU_WIDTH,
  autoFocus,
  panelRef,
  onActivate,
  onKeyNav,
  openSub,
  setOpenSub,
  level,
}: {
  items: MenuItem[];
  anchor: Rect | { x: number; y: number };
  mode: 'below' | 'right';
  width?: number;
  autoFocus: boolean;
  panelRef: (el: HTMLDivElement | null) => void;
  onActivate(it: Item): void;
  onKeyNav(e: KeyboardEvent<HTMLDivElement>, level: number, focusIndex: (i: number) => void): void;
  openSub?: string;
  setOpenSub?: (id: string | undefined, el?: HTMLElement) => void;
  level: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos(place(anchor, r.width || width, r.height, mode));
  }, [anchor, mode, items, width]);

  const focusIndex = (i: number) => buttons.current[i]?.focus();

  useEffect(() => {
    if (!autoFocus || !pos) return;
    const first = items.findIndex(isEnabled);
    if (first >= 0) focusIndex(first);
    else ref.current?.focus();
    // Only once the panel is positioned.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, pos === null]);

  return (
    <div
      ref={(el) => {
        ref.current = el;
        panelRef(el);
      }}
      role="menu"
      tabIndex={-1}
      onKeyDown={(e) => onKeyNav(e, level, focusIndex)}
      style={{
        width,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className="fixed z-[110] rounded-[8px] border border-border bg-panel py-1 text-[13px] text-text shadow-[0_10px_30px_rgb(0_0_0/0.18)] outline-none"
    >
      {items.map((it, i) => {
        if (it.kind === 'separator') {
          return <div key={it.id} role="separator" className="my-1 h-px bg-border" />;
        }
        const hasSub = it.submenu !== undefined;
        const open = hasSub && openSub === it.id;
        return (
          <button
            key={it.id}
            ref={(el) => {
              buttons.current[i] = el;
            }}
            type="button"
            role="menuitem"
            data-menu-index={i}
            aria-disabled={it.disabled || undefined}
            aria-haspopup={hasSub ? 'menu' : undefined}
            aria-expanded={hasSub ? open : undefined}
            title={it.title}
            tabIndex={-1}
            onMouseEnter={(e) => {
              if (it.disabled) return;
              e.currentTarget.focus();
              if (setOpenSub) setOpenSub(hasSub ? it.id : undefined, e.currentTarget);
            }}
            onClick={(e) => {
              if (it.disabled) return;
              if (hasSub) setOpenSub?.(open ? undefined : it.id, e.currentTarget);
              else onActivate(it);
            }}
            className={`mx-1 flex h-7 w-[calc(100%-8px)] items-center gap-2 rounded-[6px] px-2 text-left outline-none ${
              it.disabled
                ? 'cursor-default text-faint'
                : `focus:bg-row-alt ${open ? 'bg-row-alt' : ''} ${it.danger ? 'text-diff-only-a' : 'text-text'}`
            }`}
          >
            <span className="flex w-4 shrink-0 items-center justify-center" aria-hidden="true">
              {it.icon}
            </span>
            <span className="min-w-0 flex-1 truncate">{it.label}</span>
            {it.shortcut && (
              <span className="shrink-0 font-mono text-[11px] text-faint">{it.shortcut}</span>
            )}
            {hasSub && (
              <span className="shrink-0 text-faint">
                <ChevronRight />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function Menu({ items, anchor, onClose, placement = 'below', width }: MenuProps) {
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  const rootPanel = useRef<HTMLDivElement | null>(null);
  const subPanel = useRef<HTMLDivElement | null>(null);
  const [rootAnchor] = useState(() => anchorRect(anchor));
  const [sub, setSub] = useState<{ id: string; rect: Rect; focus: boolean } | undefined>();

  // Focus returns to the element focused before the menu opened.
  useEffect(() => {
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const a = document.activeElement;
      const inMenu =
        a === null ||
        a === document.body ||
        !a.isConnected ||
        rootPanel.current?.contains(a) ||
        subPanel.current?.contains(a);
      if (inMenu && prev && prev.isConnected) prev.focus();
    };
  }, []);

  // Outside click, scroll and resize close the menu. A press on the anchor element is left to
  // the anchor's own click handler (which toggles the menu).
  useEffect(() => {
    const inside = (t: EventTarget | null) =>
      t instanceof Node &&
      (rootPanel.current?.contains(t) ||
        subPanel.current?.contains(t) ||
        (anchor instanceof HTMLElement && anchor.contains(t)));
    const onPointerDown = (e: PointerEvent) => {
      if (!inside(e.target)) closeRef.current();
    };
    const onScroll = (e: Event) => {
      if (!inside(e.target)) closeRef.current();
    };
    const onResize = () => closeRef.current();
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchor]);

  const activate = (it: Item) => {
    closeRef.current();
    it.onSelect?.();
  };

  const subItems =
    sub &&
    (items.find((it) => it.kind === 'item' && it.id === sub.id) as Item | undefined)?.submenu;

  const openSubmenu = (id: string | undefined, el?: HTMLElement, focus = false) => {
    if (id === undefined || !el) {
      setSub(undefined);
      return;
    }
    if (sub?.id === id && !focus) return;
    const r = el.getBoundingClientRect();
    setSub({ id, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom }, focus });
  };

  const onKeyNav = (
    e: KeyboardEvent<HTMLDivElement>,
    level: number,
    focusIndex: (i: number) => void,
  ) => {
    const list = level === 0 ? items : (subItems ?? []);
    const panel = level === 0 ? rootPanel.current : subPanel.current;
    const active = document.activeElement as HTMLElement | null;
    const cur = Number(active?.dataset?.menuIndex ?? -1);
    const step = (dir: 1 | -1) => {
      const n = list.length;
      for (let k = 1; k <= n; k++) {
        const i = ((((cur < 0 && dir < 0 ? 0 : cur) + dir * k) % n) + n) % n;
        if (isEnabled(list[i])) return focusIndex(i);
      }
    };
    let handled = true;
    switch (e.key) {
      case 'ArrowDown':
        step(1);
        break;
      case 'ArrowUp':
        step(-1);
        break;
      case 'Home':
        focusIndex(list.findIndex(isEnabled));
        break;
      case 'End': {
        let i = list.length - 1;
        while (i >= 0 && !isEnabled(list[i])) i--;
        focusIndex(i);
        break;
      }
      case 'ArrowRight': {
        const it = list[cur];
        if (level === 0 && it && isEnabled(it) && it.submenu && active)
          openSubmenu(it.id, active, true);
        break;
      }
      case 'ArrowLeft':
        if (level === 1) {
          const parentId = sub?.id;
          setSub(undefined);
          const idx = items.findIndex((it) => it.id === parentId);
          rootPanel.current?.querySelector<HTMLElement>(`[data-menu-index="${idx}"]`)?.focus();
        }
        break;
      case 'Escape':
        if (level === 1) {
          const parentId = sub?.id;
          setSub(undefined);
          const idx = items.findIndex((it) => it.id === parentId);
          rootPanel.current?.querySelector<HTMLElement>(`[data-menu-index="${idx}"]`)?.focus();
        } else closeRef.current();
        break;
      case 'Tab':
        closeRef.current();
        break;
      case 'Enter':
      case ' ': {
        const it = list[cur];
        if (it && isEnabled(it)) {
          if (it.submenu && level === 0 && active) openSubmenu(it.id, active, true);
          else activate(it);
        }
        break;
      }
      default:
        handled = false;
    }
    // Keep the global keyboard handler (and the native button click) out of menu keys.
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    } else if (panel && e.key.length === 1) {
      e.stopPropagation();
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <Panel
        items={items}
        anchor={rootAnchor}
        mode={placement}
        width={width}
        autoFocus
        level={0}
        panelRef={(el) => {
          rootPanel.current = el;
        }}
        onActivate={activate}
        onKeyNav={onKeyNav}
        openSub={sub?.id}
        setOpenSub={(id, el) => openSubmenu(id, el)}
      />
      {sub && subItems && (
        <Panel
          key={sub.id}
          items={subItems}
          anchor={sub.rect}
          mode="right"
          autoFocus={sub.focus}
          level={1}
          panelRef={(el) => {
            subPanel.current = el;
          }}
          onActivate={activate}
          onKeyNav={onKeyNav}
        />
      )}
    </>,
    document.body,
  );
}
