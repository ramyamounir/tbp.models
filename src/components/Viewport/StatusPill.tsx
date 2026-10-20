import { Fragment } from 'react';
import { getGraph, useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';

export const NO_SM_CHANNEL = 'No SM channel — showing LM channels only';

/** Channel list with node counts (from the current graph in the store, not from the scene). */
export function StatusPill() {
  const graph = useViewerStore((s) => getGraph(s.model, s.lmId, s.graphId));
  if (!graph) return null;
  const n = graph.channels.length;
  const noSm = n > 0 && !graph.channels.some((c) => c.kind === 'sm');
  return (
    <div
      role="status"
      className="pointer-events-auto flex max-w-full min-w-0 items-center gap-2 overflow-hidden rounded-full border border-border bg-panel px-3 py-1.5 font-mono text-[12px] text-text shadow-sm"
    >
      <span className="h-2 w-2 shrink-0 rounded-full bg-text" aria-hidden="true" />
      <span className="shrink-0">
        {n} {n === 1 ? 'channel' : 'channels'}
      </span>
      {graph.channels.map((c) => (
        <Fragment key={c.channel}>
          <span className="shrink-0 text-faint" aria-hidden="true">
            ·
          </span>
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${c.kind === 'sm' ? 'bg-ch-sm' : 'bg-ch-lm'}`}
            aria-hidden="true"
          />
          <DisplayName value={c.channel} max={40} />
          <span className="shrink-0 text-muted">· {c.n.toLocaleString('en-US')} nodes</span>
        </Fragment>
      ))}
      {noSm && (
        <>
          <span className="shrink-0 text-faint" aria-hidden="true">
            ·
          </span>
          <span className="shrink-0 font-sans text-[11px] text-muted">{NO_SM_CHANNEL}</span>
        </>
      )}
    </div>
  );
}
