import { useViewerStore } from '../../state/store';

/** Segmented LM control; switching LM selects that LM's first readable graph. */
export function LmSelector() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const selectGraph = useViewerStore((s) => s.selectGraph);
  if (!model) return <p className="text-xs text-faint">—</p>;
  if (model.lms.length === 0)
    return <p className="text-xs text-faint">No learning modules in this model</p>;
  return (
    <div
      role="group"
      aria-label="Learning module"
      className="flex flex-wrap gap-1 rounded-lg border border-border bg-bg p-1"
    >
      {model.lms.map((lm) => {
        const active = lm.lmId === lmId;
        return (
          <button
            key={lm.lmId}
            type="button"
            aria-pressed={active}
            onClick={() => selectGraph(lm.lmId, lm.graphIds[0])}
            title={`${lm.graphIds.length} ${lm.graphIds.length === 1 ? 'graph' : 'graphs'}`}
            className={`h-7 min-w-[56px] flex-1 rounded-md px-2 text-[13px] ${
              active ? 'bg-panel font-semibold text-text shadow-sm' : 'text-muted hover:text-text'
            }`}
          >
            LM {lm.lmId}
          </button>
        );
      })}
    </div>
  );
}
