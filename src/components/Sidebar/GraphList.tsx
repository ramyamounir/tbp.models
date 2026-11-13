import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import { markerKey, rowMarkers, type RowMarker } from '../../edit/markers';
import { takenIds } from '../../edit/ops';
import { findReferrers } from '../../edit/references';
import { validateName } from '../../edit/names';
import type { LmEntry, ModelFile, ObjectGraph, UnreadableGraph } from '../../model/types';
import {
  cancelRename,
  commitRename,
  listScope,
  multiKeysFor,
  readableRowKey,
  resolveRowKeys,
  setMulti,
  startRename,
  unreadableRowKey,
  useEditUi,
} from '../../state/editUi';
import { setGraphDrag, GRAPH_DRAG_TYPE } from '../../state/graphDrag';
import { unsavedRecords, useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import { Menu, type MenuAnchor } from '../ui/Menu';
import { CopyToMenu, type CopySource } from './CopyToMenu';
import { buildBulkActions, buildRowMenu, type GraphActionContext } from './graphActions';

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

function MoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  );
}

function LinkIcon() {
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
      <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
      <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
    </svg>
  );
}

/** 14 px checkbox shown before the name while a multi-selection exists (visual only). */
function Check({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border ${
        checked ? 'border-accent bg-accent text-panel' : 'border-faint bg-panel'
      }`}
    >
      {checked && (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M5 12l5 5 9-10" />
        </svg>
      )}
    </span>
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

/** 3 × 20 px bar at the row's left edge: green = added, amber = renamed (until export). */
function EditMarker({ kind }: { kind: RowMarker }) {
  const label = kind === 'added' ? 'Added since last export' : 'Renamed since last export';
  return (
    <span
      title={label}
      aria-label={label}
      className={`absolute top-1/2 left-0 h-5 w-[3px] -translate-y-1/2 rounded-full ${
        kind === 'added' ? 'bg-diff-only-b' : 'bg-diff-changed'
      }`}
    />
  );
}

/** Inline rename field with validation and the reference callout (mockup 02). */
function RenameField({
  fileId,
  lm,
  view,
  graphId,
  onDone,
}: {
  fileId: string;
  lm: LmEntry;
  view: ModelFile;
  graphId: string;
  onDone(): void;
}) {
  const [value, setValue] = useState(graphId);
  const [rewrite, setRewrite] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  const taken = useMemo(() => takenIds(lm), [lm]);
  // Referrers of the model being renamed, computed once when the field opens.
  const [refs] = useState(() => findReferrers(view, lm.lmId, graphId));
  const parents = new Set(refs.map((r) => `${r.lmId}\u0000${r.graphId}`)).size;
  const parentLms = [...new Set(refs.map((r) => r.lmId))].sort((a, b) => a - b).join(', ');
  const error = value === graphId ? undefined : validateName(value, taken, lm.lmId);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (error !== undefined) return;
    commitRename(fileId, lm.lmId, graphId, value, rewrite);
    onDone();
  };

  return (
    <div
      className="py-1 pr-1 pl-1.5"
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={(e) => {
        // Blur cancels, unless focus moves within the field (the "Update references" checkbox).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) cancelRename();
      }}
      onKeyDown={(e) => {
        // Keep the list's arrow-key navigation out of the field.
        e.stopPropagation();
        if (e.key === 'Enter' && e.target === inputRef.current) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelRename();
          onDone();
        }
      }}
    >
      <label className="flex h-7 items-center gap-2 rounded-md border-[1.5px] border-accent bg-panel px-1.5 ring-2 ring-accent-bg">
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.currentTarget.value)}
          aria-label={`Rename ${graphId}`}
          aria-invalid={error !== undefined}
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none"
        />
        <span className="shrink-0 font-mono text-[10px] text-faint" aria-hidden="true">
          ↵ save
        </span>
      </label>
      {error !== undefined && (
        <p role="alert" className="mt-1 px-0.5 text-[11px] text-diff-only-a">
          {error}
        </p>
      )}
      {refs.length > 0 && (
        <div className="mt-1.5 rounded-md bg-lm-bg px-2 py-1.5 text-[11px] text-lm">
          <p className="flex items-center gap-1.5">
            <LinkIcon />
            <span>
              Child of {parents} {parents === 1 ? 'graph' : 'graphs'} in LM {parentLms} (object_id).
            </span>
          </p>
          <label className="mt-1 flex cursor-pointer items-center gap-1.5 pl-[18px] text-text">
            <input
              type="checkbox"
              checked={rewrite}
              onChange={(e) => setRewrite(e.currentTarget.checked)}
              className="h-3 w-3 accent-[var(--lm)]"
            />
            Update references
          </label>
        </div>
      )}
    </div>
  );
}

/**
 * Drag image: the name (and "+k" for several), built with createElement / textContent (never
 * innerHTML: names are file-derived). Removed right after the browser has snapshotted it.
 */
function setDragImage(e: DragEvent, ids: string[]): void {
  if (typeof document === 'undefined' || typeof e.dataTransfer.setDragImage !== 'function') return;
  const el = document.createElement('div');
  el.style.cssText =
    'position:fixed;top:-1000px;left:-1000px;display:flex;gap:6px;align-items:center;max-width:240px;' +
    'padding:4px 10px;border-radius:6px;background:#16181d;color:#fff;font:12px ui-monospace,monospace;' +
    'white-space:nowrap;box-shadow:0 6px 18px rgb(0 0 0 / 0.25)';
  const name = document.createElement('span');
  name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;unicode-bidi:isolate';
  name.textContent = displayName(ids[0], { max: 48 }).text;
  el.appendChild(name);
  if (ids.length > 1) {
    const more = document.createElement('span');
    more.style.cssText = 'flex-shrink:0;opacity:0.7';
    more.textContent = `+${ids.length - 1}`;
    el.appendChild(more);
  }
  document.body.appendChild(el);
  e.dataTransfer.setDragImage(el, 12, 12);
  setTimeout(() => el.remove(), 0);
}

type Row =
  | { kind: 'r'; key: string; graphId: string; graph: ObjectGraph }
  | { kind: 'u'; key: string; u: UnreadableGraph };

/** Rows of an LM in `order` (unreadable rows at their on-disk position). */
function rowsOf(lm: LmEntry): Row[] {
  const rows: Row[] = [];
  for (const it of lm.order) {
    if (it.kind === 'r') {
      const g = lm.graphs.get(it.graphId);
      if (g)
        rows.push({ kind: 'r', key: readableRowKey(it.graphId), graphId: it.graphId, graph: g });
    } else {
      const u = lm.unreadable.find(
        (x) => x.origin.lmId === it.origin.lmId && x.origin.entry === it.origin.entry,
      );
      if (u) rows.push({ kind: 'u', key: unreadableRowKey(u.origin), u });
    }
  }
  return rows;
}

/**
 * Filterable graph list of the current LM. Mounted with `key={fileId-loadGen-lmId}` by the
 * Sidebar so the (component-local) filter query resets when the file or LM changes. The list is
 * a `role="listbox"`: `ArrowUp`/`ArrowDown`/`Home`/`End` select readable graphs in filtered
 * order (no wrap-around); `ArrowDown` in the filter input moves focus to the list.
 *
 * Editing (spec multi-file-edit-diff Phase 3a): `Ctrl`/`Cmd`+click and `Shift`+click build a
 * multi-selection (state in `editUi`), each row has a "⋯" / right-click menu, double-click on a
 * name renames inline, a bulk bar acts on two or more selected rows, and edited rows carry a
 * left-edge marker until export.
 */
export function GraphList() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const fileId = useViewerStore((s) => s.activeFileId);
  const file = useViewerStore((s) => s.files.find((f) => f.id === s.activeFileId));
  const selectGraph = useViewerStore((s) => s.selectGraph);
  const scope = listScope(fileId, lmId);
  const multiState = useEditUi((s) => s.multi);
  const renaming = useEditUi((s) => s.renaming);
  const [query, setQuery] = useState('');
  const [menu, setMenu] = useState<{ key: string; anchor: MenuAnchor } | null>(null);
  const [copyMenu, setCopyMenu] = useState<{ source: CopySource; anchor: HTMLElement } | null>(
    null,
  );
  const listRef = useRef<HTMLUListElement>(null);
  const lm = model?.lms[lmId];

  const allRows = useMemo(() => (lm ? rowsOf(lm) : []), [lm]);
  const markers = useMemo(
    () => (file ? rowMarkers(unsavedRecords(file).records) : new Map<string, RowMarker>()),
    [file],
  );

  const q = query.trim().toLowerCase();
  const rows =
    q === ''
      ? allRows
      : allRows.filter((r) => (r.kind === 'r' ? r.graphId : r.u.graphId).toLowerCase().includes(q));
  const readable = rows.filter((r): r is Extract<Row, { kind: 'r' }> => r.kind === 'r');
  const selectedRow = graphId === undefined ? -1 : readable.findIndex((r) => r.graphId === graphId);
  const selectedRowIndex = selectedRow < 0 ? -1 : rows.indexOf(readable[selectedRow]);

  // Multi-selection of this list, without rows that no longer exist (deleted by an edit).
  const existing = useMemo(() => new Set(allRows.map((r) => r.key)), [allRows]);
  const multiKeys = multiKeysFor(multiState, scope).filter((k) => existing.has(k));
  const multi = new Set(multiKeys);

  const renamingId =
    renaming && renaming.fileId === fileId && renaming.lmId === lmId ? renaming.graphId : undefined;

  // Keep the selected row visible (keyboard, breadcrumb picker or "Open in LM k →" navigation).
  useEffect(() => {
    if (selectedRowIndex < 0) return;
    listRef.current
      ?.querySelector(`#graph-row-${selectedRowIndex}`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedRowIndex]);

  // A rename started from the keyboard / menu on a filtered-out row clears the filter; a rename
  // whose model disappeared (an earlier queued edit) is dropped.
  const renameVisible =
    renamingId !== undefined && rows.some((r) => r.kind === 'r' && r.graphId === renamingId);
  const renameExists = renamingId !== undefined && lm?.graphs.has(renamingId);
  const [renameSeen, setRenameSeen] = useState<string | undefined>(undefined);
  if (renamingId !== renameSeen) {
    setRenameSeen(renamingId);
    if (renamingId !== undefined && renameExists && !renameVisible) setQuery('');
  }
  useEffect(() => {
    if (renamingId !== undefined && !renameExists) cancelRename();
  }, [renamingId, renameExists]);

  if (!lm || !model || fileId === undefined) return <p className="text-xs text-faint">—</p>;

  /** Action context for a row: the whole multi-selection when the row is part of it. */
  const contextFor = (row: Row): GraphActionContext => {
    const keys = multi.has(row.key) ? multiKeys : [row.key];
    const { graphIds, unreadable } = resolveRowKeys(lm, keys);
    return {
      fileId,
      lmId,
      graphIds,
      unreadableOrigins: unreadable,
      unreadable: unreadable.length > 0,
      startRename: () => {
        if (graphIds.length === 1 && unreadable.length === 0)
          startRename(fileId, lmId, graphIds[0]);
      },
    };
  };

  const onRowClick = (e: MouseEvent, row: Row) => {
    if (e.ctrlKey || e.metaKey) {
      const keys = multi.has(row.key)
        ? multiKeys.filter((k) => k !== row.key)
        : [...multiKeys, row.key];
      setMulti(scope, keys, row.key);
      return;
    }
    if (e.shiftKey) {
      const anchorKey =
        (multiState.scope === scope ? multiState.anchor : undefined) ??
        (graphId !== undefined ? readableRowKey(graphId) : row.key);
      let a = rows.findIndex((r) => r.key === anchorKey);
      const b = rows.indexOf(row);
      if (a < 0) a = b;
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      setMulti(
        scope,
        rows.slice(lo, hi + 1).map((r) => r.key),
        anchorKey,
      );
      return;
    }
    setMulti(scope, [], row.key);
    if (row.kind === 'r') selectGraph(lmId, row.graphId);
  };

  const openMenu = (row: Row, anchor: MenuAnchor) => setMenu({ key: row.key, anchor });

  /** Row drag (Phase 3b): the whole multi-selection when the row is part of it, else the row. */
  const onRowDragStart = (e: DragEvent, row: Extract<Row, { kind: 'r' }>) => {
    const ids = multi.has(row.key) ? resolveRowKeys(lm, multiKeys).graphIds : [row.graphId];
    if (ids.length === 0) {
      e.preventDefault();
      return;
    }
    const token = setGraphDrag({ fileId, lmId, graphIds: ids });
    if (token === undefined) return;
    e.dataTransfer.setData(GRAPH_DRAG_TYPE, token);
    e.dataTransfer.effectAllowed = 'copy';
    setDragImage(e, ids);
  };

  const onListKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    if (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey)) {
      const row = selectedRowIndex >= 0 ? rows[selectedRowIndex] : undefined;
      const el = listRef.current?.querySelector<HTMLElement>(`#graph-row-${selectedRowIndex}`);
      if (row && el) {
        e.preventDefault();
        openMenu(row, el);
      }
      return;
    }
    if (e.key === 'Escape' && multiKeys.length > 0) {
      e.preventDefault();
      e.stopPropagation();
      setMulti(scope, []);
      return;
    }
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
    if (next !== selectedRow) selectGraph(lmId, readable[next].graphId);
  };

  const onFilterKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowDown' || !listRef.current) return;
    e.preventDefault();
    listRef.current.focus();
  };

  const noReadable = lm.graphIds.length === 0;
  const nUnreadable = lm.unreadable.length;
  const menuRow = menu ? allRows.find((r) => r.key === menu.key) : undefined;
  const checking = multiKeys.length > 0;
  const bulkCtx: GraphActionContext | undefined =
    multiKeys.length >= 2
      ? (() => {
          const { graphIds, unreadable } = resolveRowKeys(lm, multiKeys);
          return {
            fileId,
            lmId,
            graphIds,
            unreadableOrigins: unreadable,
            unreadable: unreadable.length > 0,
            startRename: () => {},
            openCopyTo: (anchor: HTMLElement) =>
              setCopyMenu({ source: { fileId, lmId, graphIds }, anchor }),
          };
        })()
      : undefined;

  /** "⋯" button: shown on hover, for the focused list's selected row, and while its menu is open. */
  const moreButton = (row: Row, selected: boolean) => {
    const open = menu?.key === row.key;
    return (
      <button
        type="button"
        tabIndex={-1}
        aria-label={`Actions for ${row.kind === 'r' ? row.graphId : row.u.graphId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          if (open) setMenu(null);
          else openMenu(row, e.currentTarget);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        className={`${open ? 'flex bg-accent-bg text-accent' : 'hidden text-muted'} h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[5px] group-hover/row:flex hover:bg-accent-bg hover:text-accent ${
          selected ? 'group-focus-within/list:flex' : ''
        }`}
      >
        <MoreIcon />
      </button>
    );
  };

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
      {rows.length === 0 ? (
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
          aria-multiselectable="true"
          aria-activedescendant={
            selectedRowIndex >= 0 ? `graph-row-${selectedRowIndex}` : undefined
          }
          onKeyDown={onListKeyDown}
          className="group/list mt-2 max-h-[360px] overflow-y-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          {rows.map((row, i) => {
            const checked = multi.has(row.key);
            if (row.kind === 'u') {
              const u = row.u;
              const reason = displayName(u.reason, { max: 512 });
              return (
                <li
                  key={row.key}
                  id={`graph-row-${i}`}
                  role="option"
                  aria-selected={checked}
                  aria-disabled="true"
                  title={reason.full}
                  onClick={(e) => onRowClick(e, row)}
                  onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    openMenu(row, { x: e.clientX, y: e.clientY });
                  }}
                  className={`group/row relative cursor-default border-l-2 border-transparent px-2 py-1.5 ${
                    checked ? 'bg-accent-bg/60' : ''
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2 font-mono text-[13px] text-muted">
                    {checking && <Check checked={checked} />}
                    <DisplayName value={u.graphId} className="flex-1 opacity-60" />
                    <span className="shrink-0 text-[10px] tracking-wide uppercase opacity-60">
                      unreadable
                    </span>
                    {moreButton(row, false)}
                  </div>
                  <p className="truncate text-[11px] text-faint opacity-80">{reason.text}</p>
                </li>
              );
            }
            const id = row.graphId;
            const g = row.graph;
            const selected = id === graphId;
            const bad = nonFinite(g);
            const marker = markers.get(markerKey(lmId, id));
            if (id === renamingId) {
              return (
                <li
                  key={row.key}
                  id={`graph-row-${i}`}
                  role="option"
                  aria-selected={selected || checked}
                  className="relative"
                >
                  {marker && <EditMarker kind={marker} />}
                  <RenameField
                    fileId={fileId}
                    lm={lm}
                    view={model}
                    graphId={id}
                    onDone={() => listRef.current?.focus()}
                  />
                </li>
              );
            }
            return (
              <li
                key={row.key}
                id={`graph-row-${i}`}
                role="option"
                aria-selected={selected || checked}
                draggable
                onDragStart={(e) => onRowDragStart(e, row)}
                onDragEnd={() => setGraphDrag(null)}
                onClick={(e) => onRowClick(e, row)}
                onMouseDown={(e) => e.shiftKey && e.preventDefault()}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMenu(row, { x: e.clientX, y: e.clientY });
                }}
                className={`group/row relative flex h-[30px] w-full min-w-0 cursor-pointer items-center gap-2 border-l-2 px-2 text-left font-mono text-[13px] ${
                  selected
                    ? 'border-accent bg-accent-bg text-accent'
                    : checked
                      ? 'border-transparent bg-accent-bg/60 text-text'
                      : 'border-transparent text-text hover:bg-row-alt'
                }`}
              >
                {marker && <EditMarker kind={marker} />}
                {checking && <Check checked={checked} />}
                <span
                  className="flex min-w-0 flex-1"
                  onDoubleClick={(e) => {
                    if (e.ctrlKey || e.metaKey || e.shiftKey) return;
                    startRename(fileId, lmId, id);
                  }}
                >
                  <DisplayName value={id} className="flex-1" />
                </span>
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
                <span
                  className={`w-10 shrink-0 text-right text-[11px] text-faint group-hover/row:hidden ${
                    menu?.key === row.key ? 'hidden' : ''
                  } ${selected ? 'group-focus-within/list:hidden' : ''}`}
                >
                  {nodeCount(g).toLocaleString('en-US')}
                </span>
                <span
                  className={`w-10 shrink-0 justify-end group-hover/row:flex ${
                    menu?.key === row.key ? 'flex' : 'hidden'
                  } ${selected ? 'group-focus-within/list:flex' : ''}`}
                >
                  {moreButton(row, selected)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {bulkCtx && (
        <div
          role="toolbar"
          aria-label="Selected models"
          className="mt-2 flex h-[34px] items-center gap-1 rounded-[8px] bg-[#16181d] pr-1.5 pl-3 text-[12px] text-white"
        >
          <span className="flex-1 font-medium">{multiKeys.length} selected</span>
          {buildBulkActions(bulkCtx).map((a) =>
            'divider' in a ? (
              <span key={a.id} className="mx-1 h-4 w-px bg-white/25" aria-hidden="true" />
            ) : (
              <button
                key={a.id}
                type="button"
                title={a.title ?? a.label}
                aria-label={a.label}
                disabled={a.disabled}
                onClick={(e) => a.run(e.currentTarget)}
                className={`flex h-[26px] w-[26px] items-center justify-center rounded-[6px] hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${
                  a.danger ? 'text-[#f87171]' : 'text-white/85'
                }`}
              >
                {a.icon}
              </button>
            ),
          )}
        </div>
      )}
      {copyMenu && (
        <CopyToMenu
          source={copyMenu.source}
          anchor={copyMenu.anchor}
          onClose={() => setCopyMenu(null)}
        />
      )}
      {menu && menuRow && (
        <Menu
          items={buildRowMenu(contextFor(menuRow))}
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
