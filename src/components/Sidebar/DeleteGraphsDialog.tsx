import { useMemo, useState } from 'react';
import { referrersOf } from '../../edit/references';
import type { LmEntry, ObjectGraph } from '../../model/types';
import { cancelDelete, confirmDelete, useEditUi, type DeleteRequest } from '../../state/editUi';
import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Dialog } from '../ui/Dialog';
import { TrashIcon } from './graphActions';

const nodeCount = (g: ObjectGraph) => g.channels.reduce((s, c) => s + c.n, 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const lmList = (lms: Iterable<number>) => [...new Set(lms)].sort((a, b) => a - b).join(', ');

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

function WarnIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

interface Row {
  key: string;
  name: string;
  nodes?: number; // undefined = unreadable
  /** Distinct parent graphs (not deleted with it), by "lm\0id". */
  parents: { lmId: number; graphId: string }[];
}

function buildRows(
  lm: LmEntry,
  req: DeleteRequest,
  refs: Map<string, { lmId: number; graphId: string }[]>,
): Row[] {
  const rows: Row[] = [];
  const deleted = new Set(req.graphIds);
  for (const id of req.graphIds) {
    const g = lm.graphs.get(id);
    if (!g) continue;
    const seen = new Set<string>();
    const parents: Row['parents'] = [];
    for (const r of refs.get(id) ?? []) {
      // A parent deleted in the same edit loses nothing.
      if (r.lmId === req.lmId && deleted.has(r.graphId)) continue;
      const k = `${r.lmId}\u0000${r.graphId}`;
      if (seen.has(k)) continue;
      seen.add(k);
      parents.push({ lmId: r.lmId, graphId: r.graphId });
    }
    rows.push({ key: `r:${id}`, name: id, nodes: nodeCount(g), parents });
  }
  for (const o of req.unreadable) {
    const u = lm.unreadable.find((x) => x.origin.lmId === o.lmId && x.origin.entry === o.entry);
    if (u) rows.push({ key: `u:${o.lmId}:${o.entry}`, name: u.graphId, parents: [] });
  }
  return rows;
}

/** Delete-models confirmation with per-model reference counts; mounted once in App. */
export function DeleteGraphsDialog() {
  const req = useEditUi((s) => s.deleteRequest);
  const file = useViewerStore((s) => s.files.find((f) => f.id === req?.fileId));
  const [showAffected, setShowAffected] = useState(false);
  const lm = req && file?.view.lms[req.lmId];
  const view = file?.view;

  const rows = useMemo(() => {
    if (!req || !lm || !view) return [];
    return buildRows(lm, req, referrersOf(view, req.lmId, req.graphIds));
  }, [req, lm, view]);

  if (!req || !file || !lm || rows.length === 0) return null;

  const n = rows.length;
  const affected = new Map<string, { lmId: number; graphId: string }>();
  for (const r of rows) for (const p of r.parents) affected.set(`${p.lmId}\u0000${p.graphId}`, p);
  const m = affected.size;
  const affectedLms = lmList([...affected.values()].map((p) => p.lmId));
  const cancel = () => {
    setShowAffected(false);
    cancelDelete();
  };

  return (
    <Dialog
      open
      width={500}
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-diff-only-a-bg text-diff-only-a">
            <TrashIcon />
          </span>
          <span>
            Delete {plural(n, 'model')} from LM {req.lmId}?
          </span>
        </span>
      }
      subtitle={
        <>
          They are removed from <DisplayName value={file.name} max={48} className="font-mono" />{' '}
          when you export it. Undo with Ctrl Z.
        </>
      }
      onCancel={cancel}
      footer={
        <>
          <button
            type="button"
            data-autofocus
            onClick={cancel}
            className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              setShowAffected(false);
              confirmDelete();
            }}
            className="h-8 rounded-md bg-diff-only-a px-3 text-[13px] font-medium text-panel hover:opacity-90"
          >
            Delete {plural(n, 'model')}
          </button>
        </>
      }
    >
      <ul className="max-h-[240px] overflow-y-auto rounded-[8px] border border-border bg-bg px-3 py-1.5">
        {rows.map((r) => (
          <li key={r.key} className="flex min-w-0 items-center gap-3 py-1">
            <DisplayName value={r.name} className="flex-1 font-mono text-[12px] text-text" />
            <span className="w-[84px] shrink-0 font-mono text-[11px] text-faint">
              {r.nodes === undefined ? 'unreadable' : plural(r.nodes, 'node')}
            </span>
            {r.parents.length > 0 ? (
              <span className="flex w-[150px] shrink-0 items-center gap-1 text-[11px] text-lm">
                <LinkIcon />
                used by {plural(r.parents.length, 'graph')} in LM{' '}
                {lmList(r.parents.map((p) => p.lmId))}
              </span>
            ) : (
              <span className="w-[150px] shrink-0 text-[11px] text-faint">not referenced</span>
            )}
          </li>
        ))}
      </ul>
      {m > 0 && (
        <div className="mt-3 flex gap-2 rounded-[8px] bg-diff-changed-bg px-3 py-2.5 text-[12px] text-text">
          <span className="mt-px shrink-0 text-diff-changed">
            <WarnIcon />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">
              {plural(m, 'graph')} in LM {affectedLms} {m === 1 ? 'stores' : 'store'} these models
              as child objects
            </p>
            <p className="mt-0.5 text-muted">
              Their object_id values will no longer resolve to a graph. The parent graphs are kept
              unchanged; affected nodes show as “unresolved” in the viewer.
            </p>
            <button
              type="button"
              aria-expanded={showAffected}
              onClick={() => setShowAffected((v) => !v)}
              className="mt-1 text-[12px] font-medium text-diff-changed underline"
            >
              {showAffected ? 'Hide affected graphs' : 'Show affected graphs ›'}
            </button>
            {showAffected && (
              <ul className="mt-1 max-h-[120px] overflow-y-auto">
                {[...affected.values()].map((p) => (
                  <li
                    key={`${p.lmId}\u0000${p.graphId}`}
                    className="flex min-w-0 gap-2 font-mono text-[11px]"
                  >
                    <span className="shrink-0 text-faint">LM {p.lmId}</span>
                    <DisplayName value={p.graphId} className="flex-1" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
