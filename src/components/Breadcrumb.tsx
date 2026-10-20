import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { getGraph, useViewerStore } from '../state/store';
import { DisplayName } from '../util/DisplayName';

const BREADCRUMB_MAX = 64;

function formatNodes(n: number): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? 'node' : 'nodes'}`;
}

function Sep({ children = '›' }: { children?: string }) {
  return (
    <span className="shrink-0 text-faint select-none" aria-hidden="true">
      {children}
    </span>
  );
}

interface PickerItem {
  key: string;
  label: ReactNode;
  aside?: string;
  current: boolean;
  onSelect(): void;
}

/**
 * A breadcrumb crumb that opens a picker (popover listbox) on click. Closes on selection, outside
 * click, `Esc` (which is consumed so the global handler does not also clear the selection) or blur.
 */
function CrumbPicker({
  label,
  title,
  menuLabel,
  items,
  className,
}: {
  label: ReactNode;
  title: string;
  menuLabel: string;
  items: PickerItem[];
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    // Focus the current item (or the first) so arrow keys work immediately.
    const list = listRef.current;
    const cur =
      list?.querySelector<HTMLButtonElement>('[aria-selected="true"] button') ??
      list?.querySelector<HTMLButtonElement>('button');
    cur?.focus();
    cur?.scrollIntoView?.({ block: 'nearest' });
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const buttons = Array.from(
        listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
      );
      const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        buttons[Math.min(buttons.length - 1, Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
    }
  };

  return (
    <div ref={rootRef} className={`relative flex min-w-0 ${className ?? ''}`} onKeyDown={onKeyDown}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={`flex min-w-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-row-alt ${open ? 'bg-row-alt' : ''}`}
      >
        {label}
        <span className="shrink-0 text-[10px] text-faint" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <ul
          ref={listRef}
          role="listbox"
          aria-label={menuLabel}
          className="absolute top-full left-0 z-50 mt-1 max-h-[60vh] w-max max-w-[min(420px,90vw)] min-w-[180px] overflow-y-auto rounded-lg border border-border bg-panel py-1 shadow-lg"
        >
          {items.map((it) => (
            <li key={it.key} role="option" aria-selected={it.current}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={`flex w-full min-w-0 items-center gap-3 px-3 py-1.5 text-left font-mono text-[12px] outline-none hover:bg-row-alt focus-visible:bg-row-alt ${
                  it.current ? 'text-accent' : 'text-text'
                }`}
              >
                <span className="flex min-w-0 flex-1">{it.label}</span>
                {it.aside && <span className="shrink-0 text-[11px] text-faint">{it.aside}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * `model.pt › LM 1 › 002_cube_tbp_horz · 929 nodes`; crumbs are omitted progressively. The LM and
 * graph crumbs open pickers (spec Phase 5 "Breadcrumb navigation").
 */
export function Breadcrumb() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const selectGraph = useViewerStore((s) => s.selectGraph);
  if (!model) return <nav aria-label="Breadcrumb" className="min-w-0 flex-1" />;
  const graph = getGraph(model, lmId, graphId);
  const nodes = graph?.channels.reduce((sum, c) => sum + c.n, 0);
  const lm = model.lms[lmId];

  const lmItems: PickerItem[] = model.lms.map((l) => ({
    key: String(l.lmId),
    label: `LM ${l.lmId}`,
    aside: `${l.graphIds.length} ${l.graphIds.length === 1 ? 'graph' : 'graphs'}`,
    current: l.lmId === lmId,
    onSelect: () => selectGraph(l.lmId, l.graphIds[0]),
  }));
  const graphItems: PickerItem[] = (lm?.graphIds ?? []).map((id, i) => {
    const g = lm.graphs.get(id);
    return {
      key: `g${i}`,
      label: <DisplayName value={id} />,
      aside: g ? g.channels.reduce((s, c) => s + c.n, 0).toLocaleString('en-US') : undefined,
      current: id === graphId,
      onSelect: () => selectGraph(lmId, id),
    };
  });

  return (
    <nav
      aria-label="Breadcrumb"
      className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-[13px] text-text"
    >
      <DisplayName
        value={model.fileName}
        max={BREADCRUMB_MAX}
        className="shrink max-[700px]:hidden"
      />
      <Sep />
      <CrumbPicker
        className="shrink-0"
        label={<span>LM {lmId}</span>}
        title="Choose a learning module"
        menuLabel="Learning modules"
        items={lmItems}
      />
      {graphId !== undefined && (
        <>
          <Sep />
          <CrumbPicker
            label={<DisplayName value={graphId} max={BREADCRUMB_MAX} />}
            title={`Choose a graph in LM ${lmId}`}
            menuLabel={`Graphs in LM ${lmId}`}
            items={graphItems}
          />
          {nodes !== undefined && (
            <span className="flex shrink-0 items-center gap-1.5 max-[900px]:hidden">
              <Sep>·</Sep>
              <span className="text-muted">{formatNodes(nodes)}</span>
            </span>
          )}
        </>
      )}
    </nav>
  );
}
