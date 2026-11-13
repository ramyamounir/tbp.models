/**
 * Diff legend: floats over the bottom-left corner of a pane and lists the classes that pane
 * draws, with counts and eye toggles (Overlay: all four; a pane of one model: equal, changed and
 * that model's "only in" class). Hidden classes are shared by all panes. The property is chosen
 * in the summary's PROPERTIES list; while one is chosen the "changed" row names it.
 */
import { NodeClass, type DiffResult } from '../../diff/compare';
import { classCounts, effectiveProperty } from '../../diff/viewClasses';
import { useViewerStore } from '../../state/store';

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

/** Swatch class per node class (Phase 1 diff tokens). */
const CLASS_SWATCH: Record<NodeClass, string> = {
  [NodeClass.Equal]: 'bg-diff-equal',
  [NodeClass.Changed]: 'bg-diff-changed',
  [NodeClass.OnlyA]: 'bg-diff-only-a',
  [NodeClass.OnlyB]: 'bg-diff-only-b',
};

const CLASS_LABEL: Record<NodeClass, string> = {
  [NodeClass.Equal]: 'equal within tolerance',
  [NodeClass.Changed]: 'changed',
  [NodeClass.OnlyA]: 'only in A',
  [NodeClass.OnlyB]: 'only in B',
};

export function DiffLegend({
  result,
  classesA,
  classesB,
  show,
}: {
  result: DiffResult;
  classesA: Map<string, Uint8Array>;
  classesB: Map<string, Uint8Array>;
  /** Classes listed, in display order. */
  show: NodeClass[];
}) {
  const property = useViewerStore((s) => s.diff.property);
  const hidden = useViewerStore((s) => s.diff.hidden);
  const toggleDiffHidden = useViewerStore((s) => s.toggleDiffHidden);
  const shown = effectiveProperty(result, property);
  const propLabel =
    shown === 'any' ? undefined : result.properties.find((p) => p.key === shown)?.label;
  const counts = classCounts(classesA, classesB);

  return (
    <div
      role="group"
      aria-label="Diff legend"
      className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] min-w-[200px] rounded-lg border border-border bg-panel/90 px-2.5 py-2 shadow-sm backdrop-blur-sm"
    >
      <ul className="flex flex-col gap-0.5">
        {show.map((cls) => {
          const off = hidden.includes(cls);
          const label = CLASS_LABEL[cls];
          return (
            <li key={cls} className="flex h-6 items-center gap-2 text-[12px] text-text">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${CLASS_SWATCH[cls]} ${off ? 'opacity-40' : ''}`}
                aria-hidden="true"
              />
              <span
                className={`flex min-w-0 flex-1 items-baseline gap-1 ${off ? 'text-faint' : ''}`}
              >
                <span className="shrink-0">{label}</span>
                {cls === NodeClass.Changed && propLabel !== undefined && (
                  <>
                    <span className="shrink-0 text-faint">·</span>
                    <span className="truncate font-mono text-[11px] text-accent">{propLabel}</span>
                  </>
                )}
              </span>
              <span className="shrink-0 pl-2 font-mono text-[11px] text-muted">
                {counts[cls].toLocaleString('en-US')}
              </span>
              <button
                type="button"
                onClick={() => toggleDiffHidden(cls)}
                aria-pressed={!off}
                title={off ? `Show ${label}` : `Hide ${label}`}
                aria-label={off ? `Show ${label}` : `Hide ${label}`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-row-alt hover:text-text"
              >
                <EyeIcon off={off} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
