import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { ObjectGraph } from '../../model/types';
import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';

const nodeCount = (g: ObjectGraph) => g.channels.reduce((s, c) => s + c.n, 0);
const nonFinite = (g: ObjectGraph) => g.channels.reduce((s, c) => s + c.nonFiniteRows, 0);

function SearchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

/** One small dot per input channel (`--sm` for SM, `--lm` for LM channels); tooltip = name + count. */
function ChannelDots({ graph }: { graph: ObjectGraph }) {
  return (
    <span className="flex shrink-0 items-center gap-0.5">
      {graph.channels.map((c, k) => {
        const tip = `${displayName(c.channel).text} · ${c.n.toLocaleString('en-US')} ${c.n === 1 ? 'node' : 'nodes'}`;
        return (
          <span
            key={k}
            title={tip}
            aria-label={tip}
            className={`h-1.5 w-1.5 rounded-full ${c.kind === 'sm' ? 'bg-ch-sm' : 'bg-ch-lm'}`}
          />
        );
      })}
    </span>
  );
}

/**
 * Filterable graph list of the current LM. Mounted with `key={loadGen-lmId}` by the Sidebar so
 * the (component-local) filter query resets when the model or LM changes. The list is a
 * `role="listbox"`: `ArrowUp`/`ArrowDown`/`Home`/`End` select readable graphs in filtered order
 * (no wrap-around); `ArrowDown` in the filter input moves focus to the list (spec Phase 5
 * "Graph list keyboard").
 */
export function GraphList() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const selectGraph = useViewerStore((s) => s.selectGraph);
  const [query, setQuery] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const lm = model?.lms[lmId];

  const q = query.trim().toLowerCase();
  const matches = (id: string) => id.toLowerCase().includes(q);
  const readable = lm ? lm.graphIds.filter(matches) : [];
  const unreadable = lm ? lm.unreadable.filter((u) => matches(u.graphId)) : [];
  const selectedRow = graphId === undefined ? -1 : readable.indexOf(graphId);

  // Keep the selected row visible (keyboard, breadcrumb picker or "Open in LM k →" navigation).
  useEffect(() => {
    if (selectedRow < 0) return;
    listRef.current
      ?.querySelector(`#graph-row-${selectedRow}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedRow]);

  if (!lm) return <p className="text-xs text-faint">—</p>;

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey || readable.length === 0) return;
    let next: number;
    switch (e.key) {
      case 'ArrowDown':
        next = selectedRow < 0 ? 0 : Math.min(readable.length - 1, selectedRow + 1);
        break;
      case 'ArrowUp':
        next = selectedRow < 0 ? readable.length - 1 : Math.max(0, selectedRow - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = readable.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== selectedRow) selectGraph(lmId, readable[next]);
  };

  const onFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown' || !listRef.current) return;
    e.preventDefault();
    listRef.current.focus();
  };

  const noReadable = lm.graphIds.length === 0;
  const nUnreadable = lm.unreadable.length;

  return (
    <div>
      <label className="flex h-8 items-center gap-2 rounded-md border border-border bg-panel px-2.5 text-muted focus-within:border-accent">
        <SearchIcon />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onFilterKeyDown}
          placeholder="Filter objects…"
          aria-label="Filter graphs"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-faint"
        />
      </label>
      {noReadable && (
        <div className="mt-3 rounded-md border border-dashed border-border bg-bg px-3 py-3 text-center">
          <p className="text-[13px] text-muted">No graphs in LM {lmId}</p>
          {nUnreadable > 0 && (
            <p className="mt-0.5 text-[11px] text-faint">
              {nUnreadable} unreadable {nUnreadable === 1 ? 'graph' : 'graphs'} listed below
            </p>
          )}
        </div>
      )}
      {readable.length + unreadable.length === 0 ? (
        q !== '' && (
          <p className="mt-3 text-xs text-faint">
            No graphs match “<DisplayName value={query.trim()} max={40} />”
          </p>
        )
      ) : (
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={`Graphs in LM ${lmId}`}
          aria-activedescendant={selectedRow >= 0 ? `graph-row-${selectedRow}` : undefined}
          onKeyDown={onListKeyDown}
          className="mt-2 max-h-[360px] overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {readable.map((id, i) => {
            const g = lm.graphs.get(id)!;
            const selected = i === selectedRow;
            const bad = nonFinite(g);
            return (
              <li
                key={id}
                id={`graph-row-${i}`}
                role="option"
                aria-selected={selected}
                onClick={() => selectGraph(lmId, id)}
                className={`flex w-full min-w-0 cursor-pointer items-center gap-2 border-l-2 px-2 py-1.5 text-left font-mono text-[13px] ${
                  selected
                    ? 'border-accent bg-accent-bg text-accent'
                    : 'border-transparent text-text hover:bg-row-alt'
                }`}
              >
                <DisplayName value={id} className="flex-1" />
                {bad > 0 && (
                  <span
                    className="shrink-0 rounded bg-select/15 px-1 text-[10px] text-select"
                    title={`${bad} ${bad === 1 ? 'point' : 'points'} with non-finite positions hidden`}
                    aria-label={`${bad} ${bad === 1 ? 'point' : 'points'} with non-finite positions hidden`}
                  >
                    ⚠ {bad}
                  </span>
                )}
                <ChannelDots graph={g} />
                <span className="w-10 shrink-0 text-right text-[11px] text-faint">
                  {nodeCount(g).toLocaleString('en-US')}
                </span>
              </li>
            );
          })}
          {unreadable.map((u, k) => {
            const reason = displayName(u.reason, { max: 512 });
            return (
              <li
                key={`unreadable-${k}`}
                id={`graph-row-${readable.length + k}`}
                role="option"
                aria-selected={false}
                aria-disabled="true"
                title={reason.full}
                className="cursor-not-allowed border-l-2 border-transparent px-2 py-1.5 opacity-60"
              >
                <div className="flex min-w-0 items-center gap-2 font-mono text-[13px] text-muted">
                  <DisplayName value={u.graphId} className="flex-1" />
                  <span className="shrink-0 text-[10px] tracking-wide uppercase">unreadable</span>
                </div>
                <p className="truncate text-[11px] text-faint">{reason.text}</p>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
