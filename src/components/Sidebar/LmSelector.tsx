import { firstGraphId } from '../../model/natsort';
import { useMemo, useState, type DragEvent } from 'react';
import { addedLmMarkers } from '../../edit/markers';
import { addLmAction, duplicateLmAction, editFailed, requestDeleteLm } from '../../state/editUi';
import { acceptsGraphDrag, getGraphDrag, readGraphDrop } from '../../state/graphDrag';
import { unsavedRecords, useViewerStore } from '../../state/store';
import { Menu, type MenuItem } from '../ui/Menu';
import { copyTargetItems, runCopy } from './CopyToMenu';
import { CopyToIcon, DuplicateIcon, TrashIcon } from './graphActions';

function PlusIcon() {
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
      <path d="M12 5v14M5 12h14" />
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

/**
 * Segmented LM control; switching LM selects that LM's first readable graph. Phase 3b: a "+"
 * button appends an empty LM, an LM added since the last export carries a green dot, and each LM
 * button is a drop target for graph rows (copies them into that LM of the active file).
 */
export function LmSelector() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const fileId = useViewerStore((s) => s.activeFileId);
  const file = useViewerStore((s) => s.files.find((f) => f.id === s.activeFileId));
  const selectGraph = useViewerStore((s) => s.selectGraph);
  const [dropOver, setDropOver] = useState<number | undefined>(undefined);
  const added = useMemo(
    () => (file ? addedLmMarkers(unsavedRecords(file).records) : new Set<number>()),
    [file],
  );
  if (!model || fileId === undefined) return <p className="text-xs text-faint">—</p>;

  /** A graph drag of this tab that would copy something (not onto its own LM). */
  const canDrop = (e: DragEvent, k: number) => {
    if (!acceptsGraphDrag(e)) return false;
    const p = getGraphDrag();
    return p !== null && !(p.fileId === fileId && p.lmId === k);
  };
  const onDragOver = (e: DragEvent, k: number) => {
    if (!canDrop(e, k)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dropOver !== k) setDropOver(k);
  };
  const onDrop = (e: DragEvent, k: number) => {
    setDropOver(undefined);
    if (!acceptsGraphDrag(e)) return;
    e.preventDefault();
    const payload = readGraphDrop(e);
    if (payload === null) return;
    runCopy(payload, { fileId, lmId: k }).catch(editFailed);
  };

  const plus = (
    <button
      type="button"
      title="New empty LM"
      aria-label="New empty LM"
      onClick={() => addLmAction(fileId)}
      className="flex h-[38px] w-[30px] shrink-0 items-center justify-center rounded-lg border border-border bg-panel text-muted hover:bg-row-alt hover:text-text"
    >
      <PlusIcon />
    </button>
  );

  if (model.lms.length === 0)
    return (
      <div className="flex items-center gap-1.5">
        <p className="flex-1 text-xs text-faint">No learning modules in this model</p>
        {plus}
      </div>
    );
  return (
    <div className="flex items-start gap-1.5">
      <div
        role="group"
        aria-label="Learning module"
        className="flex min-w-0 flex-1 flex-wrap gap-1 rounded-lg border border-border bg-bg p-1"
      >
        {model.lms.map((lm) => {
          const active = lm.lmId === lmId;
          const n = lm.graphIds.length;
          const isNew = added.has(lm.lmId);
          return (
            <button
              key={lm.lmId}
              type="button"
              aria-pressed={active}
              onClick={() => selectGraph(lm.lmId, firstGraphId(lm))}
              onDragEnter={(e) => onDragOver(e, lm.lmId)}
              onDragOver={(e) => onDragOver(e, lm.lmId)}
              onDragLeave={() => setDropOver((d) => (d === lm.lmId ? undefined : d))}
              onDrop={(e) => onDrop(e, lm.lmId)}
              title={`${n} ${n === 1 ? 'graph' : 'graphs'}${isNew ? ' · added since last export' : ''}`}
              className={`relative h-7 min-w-[48px] flex-1 rounded-md px-2 text-[13px] ${
                active ? 'bg-panel font-semibold text-text shadow-sm' : 'text-muted hover:text-text'
              } ${dropOver === lm.lmId ? 'ring-2 ring-diff-only-b' : ''}`}
            >
              LM {lm.lmId}
              {isNew && (
                <span
                  aria-label="Added since last export"
                  className="absolute top-1 right-1 h-[5px] w-[5px] rounded-full bg-diff-only-b"
                />
              )}
            </button>
          );
        })}
      </div>
      {plus}
    </div>
  );
}

/**
 * "⋯" button of the LEARNING MODULE section header (Phase 3b): Duplicate LM k, Copy all graphs
 * to… ▸ (never LM k itself), Delete LM k (confirmation dialog).
 */
export function LmActionsButton() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const fileId = useViewerStore((s) => s.activeFileId);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const lm = model?.lms[lmId];
  if (!model || !lm || fileId === undefined) return null;

  const items = (): MenuItem[] => {
    const none = lm.graphIds.length === 0;
    return [
      {
        kind: 'item',
        id: 'duplicateLm',
        label: `Duplicate LM ${lmId}`,
        icon: <DuplicateIcon />,
        onSelect: () => duplicateLmAction(fileId, lmId),
      },
      none
        ? {
            kind: 'item',
            id: 'copyAll',
            label: 'Copy all graphs to…',
            icon: <CopyToIcon />,
            disabled: true,
            title: 'No readable graphs',
          }
        : {
            kind: 'item',
            id: 'copyAll',
            label: 'Copy all graphs to…',
            icon: <CopyToIcon />,
            submenu: copyTargetItems({ fileId, lmId, graphIds: lm.graphIds }),
          },
      { kind: 'separator', id: 'sep-before-delete' },
      {
        kind: 'item',
        id: 'deleteLm',
        label: `Delete LM ${lmId}`,
        icon: <TrashIcon />,
        danger: true,
        onSelect: () => requestDeleteLm(fileId, lmId),
      },
    ];
  };

  const open = anchor !== null;
  return (
    <>
      <button
        type="button"
        aria-label={`Actions for LM ${lmId}`}
        title={`Actions for LM ${lmId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        className={`flex h-[22px] w-[22px] items-center justify-center rounded-[5px] hover:bg-accent-bg hover:text-accent ${
          open ? 'bg-accent-bg text-accent' : 'text-muted'
        }`}
      >
        <MoreIcon />
      </button>
      {anchor && <Menu items={items()} anchor={anchor} onClose={() => setAnchor(null)} />}
    </>
  );
}
