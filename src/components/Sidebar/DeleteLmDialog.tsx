import { useMemo, useState } from 'react';
import { lmDeleteImpact, type LmDeleteImpact } from '../../edit/references';
import { cancelDeleteLm, confirmDeleteLm, useEditUi } from '../../state/editUi';
import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Dialog } from '../ui/Dialog';
import { TrashIcon } from './graphActions';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Distinct graphs of an impact list, in first-occurrence order. */
function graphsOf(
  items: LmDeleteImpact[],
): { lmId: number; graphId: string; channels: string[] }[] {
  const out = new Map<string, { lmId: number; graphId: string; channels: string[] }>();
  for (const it of items) {
    const k = `${it.lmId}\u0000${it.graphId}`;
    const g = out.get(k);
    if (g) g.channels.push(it.channel);
    else out.set(k, { lmId: it.lmId, graphId: it.graphId, channels: [it.channel] });
  }
  return [...out.values()];
}

function ImpactGroup({
  text,
  graphs,
}: {
  text: string;
  graphs: { lmId: number; graphId: string; channels: string[] }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <li className="py-1.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[12px] text-text"
      >
        <span aria-hidden="true" className="w-3 shrink-0 text-faint">
          {open ? '▾' : '▸'}
        </span>
        <span className="flex-1">{text}</span>
      </button>
      {open && (
        <ul className="mt-1 max-h-[140px] overflow-y-auto pl-[18px]">
          {graphs.map((g) => (
            <li
              key={`${g.lmId}\u0000${g.graphId}`}
              className="flex min-w-0 items-center gap-2 font-mono text-[11px]"
            >
              <span className="shrink-0 text-faint">LM {g.lmId}</span>
              <DisplayName value={g.graphId} className="flex-1 text-text" />
              <DisplayName
                value={g.channels.join(', ')}
                max={40}
                className="max-w-[45%] shrink-0 text-faint"
              />
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/** Delete-LM confirmation listing what the renumbering affects (Phase 3b); mounted once in App. */
export function DeleteLmDialog() {
  const req = useEditUi((s) => s.lmDeleteRequest);
  const file = useViewerStore((s) => s.files.find((f) => f.id === req?.fileId));
  const view = file?.view;
  const lm = req && view?.lms[req.lmId];

  const impact = useMemo(
    () => (req && view && lm ? lmDeleteImpact(view, req.lmId) : []),
    [req, view, lm],
  );
  if (!req || !file || !lm) return null;

  const k = req.lmId;
  const removed = graphsOf(impact.filter((i) => i.kind === 'removed'));
  const renumbered = graphsOf(impact.filter((i) => i.kind === 'renumbered'));
  const nModels = lm.graphIds.length + lm.unreadable.length;
  const later = view!.lms.length - 1 - k;

  return (
    <Dialog
      open
      width={480}
      title={
        <span className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-diff-only-a-bg text-diff-only-a">
            <TrashIcon />
          </span>
          <span>Delete LM {k}?</span>
        </span>
      }
      subtitle={
        <>
          Removes LM {k} and its {plural(nModels, 'model')} from{' '}
          <DisplayName value={file.name} max={48} className="font-mono" /> when you export it. Undo
          with Ctrl Z.
        </>
      }
      onCancel={cancelDeleteLm}
      footer={
        <>
          <button
            type="button"
            data-autofocus
            onClick={cancelDeleteLm}
            className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDeleteLm}
            className="h-8 rounded-md bg-diff-only-a px-3 text-[13px] font-medium text-panel hover:opacity-90"
          >
            Delete LM {k}
          </button>
        </>
      }
    >
      {(removed.length > 0 || renumbered.length > 0) && (
        <ul className="rounded-[8px] border border-border bg-bg px-3 py-1">
          {removed.length > 0 && (
            <ImpactGroup
              text={`${plural(removed.length, 'graph')} take${removed.length === 1 ? 's' : ''} input from LM ${k}, which is removed`}
              graphs={removed}
            />
          )}
          {renumbered.length > 0 && (
            <ImpactGroup
              text={`${plural(renumbered.length, 'graph')} take${renumbered.length === 1 ? 's' : ''} input from a later LM, which is renumbered`}
              graphs={renumbered}
            />
          )}
        </ul>
      )}
      <p className="mt-3 text-[12px] text-muted">
        LMs after LM {k} move down by one.
        {later > 0 && (
          <>
            {' '}
            (LM {k + 1}
            {later > 1 ? `–${k + later}` : ''} become{later === 1 ? 's' : ''} LM {k}
            {later > 1 ? `–${k + later - 1}` : ''}.)
          </>
        )}
      </p>
    </Dialog>
  );
}
