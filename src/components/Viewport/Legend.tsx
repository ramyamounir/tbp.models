import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { getGraph, useViewerStore, type LegendKind } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import {
  computeColoring,
  DIMMED_KEY,
  objectIdLabel,
  rgbToCss,
  viridisGradientCss,
  type CategoricalRow,
  type RGB,
} from '../../viewer/colors';
import { useThemeColors } from './useThemeColors';

function Swatch({ color, dimmed }: { color: RGB; dimmed?: boolean }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: rgbToCss(color), opacity: dimmed ? 0.5 : 1 }}
      aria-hidden="true"
    />
  );
}

const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

function GripIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 8h14M5 12h14M5 16h14" />
    </svg>
  );
}

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg {...iconProps}>
      <path d="M10.6 5.1A9.8 9.8 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-2.2 3.2M6.6 6.6C3.7 8.5 2 12 2 12s3.5 7 10 7a9.4 9.4 0 0 0 5.4-1.6" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
    </svg>
  ) : (
    <svg {...iconProps}>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

const iconBtn =
  'flex h-5 w-5 shrink-0 items-center justify-center rounded text-faint outline-none hover:text-text focus-visible:ring-2 focus-visible:ring-accent';

interface LegendItem {
  key: string;
  /** Plain-text name for button labels. */
  name: string;
  hidden: boolean;
  content: ReactNode;
}

function HideButton({ item, onToggle }: { item: LegendItem; onToggle(key: string): void }) {
  return (
    <button
      type="button"
      className={iconBtn}
      aria-pressed={item.hidden}
      aria-label={`${item.hidden ? 'Show' : 'Hide'} ${item.name}`}
      title={item.hidden ? 'Show' : 'Hide'}
      onClick={() => onToggle(item.key)}
    >
      <EyeIcon off={item.hidden} />
    </button>
  );
}

const move = <T,>(xs: readonly T[], from: number, to: number): T[] => {
  const out = [...xs];
  out.splice(to, 0, ...out.splice(from, 1));
  return out;
};

interface Drag {
  from: number;
  to: number;
  dy: number;
  startY: number;
  pointerId: number;
  /** Row centers and heights (client px) when the drag started. */
  mids: number[];
  heights: number[];
}

/**
 * Legend rows the user can reorder (drag the grip, or ↑ / ↓ on it; the top row is drawn on top
 * where nodes overlap) and hide (eye button). `fixed` rows (e.g. "dimmed") stay below, hideable
 * but not reorderable.
 */
function SortableLegendRows({
  items,
  fixed = [],
  onReorder,
  onToggle,
}: {
  items: LegendItem[];
  fixed?: LegendItem[];
  onReorder(keys: string[]): void;
  onToggle(key: string): void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const keys = items.map((it) => it.key);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>, index: number) => {
    if (e.button !== 0 || !listRef.current) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rows = [...listRef.current.querySelectorAll<HTMLElement>(':scope > [data-sortable]')];
    const rects = rows.map((r) => r.getBoundingClientRect());
    setDrag({
      from: index,
      to: index,
      dy: 0,
      startY: e.clientY,
      pointerId: e.pointerId,
      mids: rects.map((r) => r.top + r.height / 2),
      heights: rects.map((r) => r.height),
    });
  };

  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dy = e.clientY - drag.startY;
    const center = drag.mids[drag.from] + dy;
    let to = drag.from;
    while (to < drag.mids.length - 1 && center > drag.mids[to + 1]) to++;
    while (to > 0 && center < drag.mids[to - 1]) to--;
    setDrag({ ...drag, dy, to });
  };

  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    setDrag(null);
    if (e.type === 'pointerup' && drag.to !== drag.from) onReorder(move(keys, drag.from, drag.to));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = e.key === 'ArrowUp' ? index - 1 : e.key === 'ArrowDown' ? index + 1 : -1;
    if (to < 0 || to >= keys.length) return;
    e.preventDefault();
    onReorder(move(keys, index, to));
  };

  const shift = (i: number): number => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    const h = drag.heights[drag.from];
    if (drag.from < drag.to && i > drag.from && i <= drag.to) return -h;
    if (drag.to < drag.from && i >= drag.to && i < drag.from) return h;
    return 0;
  };

  return (
    <ul ref={listRef}>
      {items.map((it, i) => {
        const dragging = drag?.from === i;
        return (
          <li
            key={it.key}
            data-sortable=""
            className={`relative flex min-w-0 items-center gap-1.5 rounded py-0.5 ${
              dragging ? 'z-10 bg-panel shadow-md' : ''
            } ${drag && !dragging ? 'transition-transform duration-150' : ''}`}
            style={{ transform: `translateY(${shift(i)}px)` }}
          >
            <button
              type="button"
              className={`${iconBtn} touch-none ${dragging ? 'cursor-grabbing' : 'cursor-grab'}`}
              aria-label={`Reorder ${it.name} (↑ / ↓)`}
              title="Drag to reorder: rows higher in the list are drawn on top where nodes overlap"
              onPointerDown={(e) => onPointerDown(e, i)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <GripIcon />
            </button>
            <div
              className={`flex min-w-0 flex-1 items-center gap-2 ${it.hidden ? 'opacity-40' : ''}`}
            >
              {it.content}
            </div>
            <HideButton item={it} onToggle={onToggle} />
          </li>
        );
      })}
      {fixed.map((it) => (
        <li key={it.key} className="flex min-w-0 items-center gap-1.5 py-0.5">
          <span className="h-5 w-5 shrink-0" aria-hidden="true" />
          <div
            className={`flex min-w-0 flex-1 items-center gap-2 ${it.hidden ? 'opacity-40' : ''}`}
          >
            {it.content}
          </div>
          <HideButton item={it} onToggle={onToggle} />
        </li>
      ))}
    </ul>
  );
}

function CategoricalLegendRow({ row }: { row: CategoricalRow }) {
  const res = row.resolution;
  const rawId = res.status === 'unresolved' ? res.id : undefined;
  return (
    <>
      <Swatch color={row.color} />
      <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[12px] text-text">
        {row.lmPrefix !== undefined && (
          <span className="shrink-0 text-muted">LM {row.lmPrefix} ·</span>
        )}
        {res.status === 'unresolved' ? (
          <span className="truncate">{rawId}</span>
        ) : (
          <>
            <DisplayName value={objectIdLabel(res)} />
            {/* spec: legend row = `name (id) · count` */}
            <span className="shrink-0 text-[10px] text-faint" title={`object_id ${row.id}`}>
              ({row.id})
            </span>
          </>
        )}
        {res.status === 'ambiguous' && (
          <span
            className="shrink-0 rounded bg-row-alt px-1 font-sans text-[10px] text-muted"
            title={`several graphs in LM ${res.lmId} share this id; the file does not say which encoding was used`}
          >
            ambiguous
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-faint">
        {row.count.toLocaleString('en-US')}
      </span>
    </>
  );
}

const categoricalName = (row: CategoricalRow) => {
  const prefix = row.lmPrefix !== undefined ? `LM ${row.lmPrefix} ` : '';
  const res = row.resolution;
  return `${prefix}${res.status === 'unresolved' ? row.id : objectIdLabel(res)}`;
};

const fmt = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(3)).toString() : '—');

/**
 * Legend for the categorical (object_id), channel-source and scalar color modes. Categorical and
 * channel rows can be reordered (color priority) and hidden; see `LegendPrefs` in the store.
 */
export function Legend() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const colorMode = useViewerStore((s) => s.colorMode);
  const prefs = useViewerStore((s) => s.legend);
  const setLegendOrder = useViewerStore((s) => s.setLegendOrder);
  const toggleLegendHidden = useViewerStore((s) => s.toggleLegendHidden);
  const showAllLegendRows = useViewerStore((s) => s.showAllLegendRows);
  const theme = useThemeColors();
  const graph = getGraph(model, lmId, graphId);
  const legend = useMemo(
    () => (model && graph ? computeColoring(model, graph, colorMode, theme, prefs).legend : null),
    [model, graph, colorMode, theme, prefs],
  );
  if (!legend) return null;

  const box =
    'pointer-events-auto w-[272px] max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-panel/95 px-3 py-2.5 shadow-sm';
  const title = 'mb-1.5 text-[11px] font-medium text-muted';

  const header = (kind: LegendKind, text: ReactNode, anyHidden: boolean) => (
    <div className="flex items-baseline justify-between gap-2">
      <p className={title}>{text}</p>
      {anyHidden && (
        <button
          type="button"
          className="text-[11px] text-accent hover:underline"
          onClick={() => showAllLegendRows(kind)}
        >
          Show all
        </button>
      )}
    </div>
  );

  if (legend.kind === 'categorical') {
    const items: LegendItem[] = legend.rows.map((r) => ({
      key: r.key,
      name: categoricalName(r),
      hidden: r.hidden,
      content: <CategoricalLegendRow row={r} />,
    }));
    const fixed: LegendItem[] =
      legend.dimmedCount > 0
        ? [
            {
              key: DIMMED_KEY,
              name: 'nodes without LM data',
              hidden: legend.dimmedHidden,
              content: (
                <>
                  <Swatch color={theme.dim} dimmed />
                  <span className="flex-1 font-mono text-[12px] text-muted">
                    no LM data (dimmed)
                  </span>
                  <span className="font-mono text-[11px] text-faint">
                    {legend.dimmedCount.toLocaleString('en-US')}
                  </span>
                </>
              ),
            },
          ]
        : [];
    return (
      <div className={box} aria-label="Color legend">
        {header(
          'categorical',
          legend.title,
          [...items, ...fixed].some((it) => it.hidden),
        )}
        {items.length === 0 && fixed.length === 0 ? (
          <p className="text-[12px] text-faint">no nodes</p>
        ) : (
          <SortableLegendRows
            items={items}
            fixed={fixed}
            onReorder={(keys) => setLegendOrder('categorical', keys)}
            onToggle={(key) => toggleLegendHidden('categorical', key)}
          />
        )}
      </div>
    );
  }

  if (legend.kind === 'channel') {
    const items: LegendItem[] = legend.rows.map((r) => ({
      key: r.channel,
      name: r.channel,
      hidden: r.hidden,
      content: (
        <>
          <Swatch color={r.color} />
          <DisplayName value={r.channel} className="flex-1 font-mono text-[12px] text-text" />
          <span
            className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
              r.kind === 'sm' ? 'bg-ch-sm-bg text-ch-sm' : 'bg-ch-lm-bg text-ch-lm'
            }`}
          >
            {r.kind.toUpperCase()}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-faint">
            {r.count.toLocaleString('en-US')}
          </span>
        </>
      ),
    }));
    return (
      <div className={box} aria-label="Color legend">
        {header(
          'channel',
          'Channel source',
          items.some((it) => it.hidden),
        )}
        <SortableLegendRows
          items={items}
          onReorder={(keys) => setLegendOrder('channel', keys)}
          onToggle={(key) => toggleLegendHidden('channel', key)}
        />
      </div>
    );
  }

  return (
    <div className={box} aria-label="Color legend">
      <p className={title}>
        Scalar · <DisplayName value={legend.label} className="font-mono text-text" />
      </p>
      {legend.noFinite ? (
        <p className="text-[12px] text-faint">no finite values</p>
      ) : (
        <>
          <div
            className="h-2.5 w-full rounded-sm"
            style={{ backgroundImage: viridisGradientCss() }}
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
            <span>{fmt(legend.min)}</span>
            <span>{fmt(legend.max)}</span>
          </div>
        </>
      )}
      <p className="mt-1.5 flex min-w-0 flex-wrap gap-x-1.5 text-[11px] text-faint">
        <span>colored:</span>
        {legend.channels.map((c) => (
          <DisplayName key={c} value={c} max={48} className="font-mono" />
        ))}
      </p>
      {legend.dimmedCount > 0 && (
        <p className="mt-0.5 text-[11px] text-faint">
          {legend.dimmedCount.toLocaleString('en-US')} nodes without this feature (dimmed)
        </p>
      )}
    </div>
  );
}
