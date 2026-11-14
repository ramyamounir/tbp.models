/**
 * Diff legend: floats over the bottom-left corner of a pane and lists the classes that pane
 * draws, with counts and eye toggles (Overlay: all four; a pane of one model: equal, changed and
 * that model's "only in" class). Hidden classes are shared by all panes. The feature is chosen
 * in the summary's FEATURES table; while one is chosen the "changed" row names it.
 *
 * In a short pane (phones, stacked panes) the legend would cover the cloud, so it starts as a
 * one-row chip of swatches and counts; tapping the chip expands it and the chevron collapses it
 * again. The choice is shared by all panes.
 */
import { useEffect, useRef, useState } from 'react';
import { NodeClass, type DiffResult } from '../../diff/compare';
import { classCounts, effectiveProperty } from '../../diff/viewClasses';
import { useViewerStore } from '../../state/store';
import { setDiffLegendOpen, useDiffUi } from './diffUi';

/** Panes shorter than this start with the legend collapsed. */
const SHORT_PANE_PX = 260;

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
  classesA: Uint8Array;
  classesB: Uint8Array;
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

  // Height of the pane's canvas area (the legend's positioned parent).
  const probe = useRef<HTMLSpanElement>(null);
  const [short, setShort] = useState(false);
  useEffect(() => {
    const host = probe.current?.parentElement;
    if (!host || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setShort(host.clientHeight < SHORT_PANE_PX));
    ro.observe(host);
    return () => ro.disconnect();
  }, []);
  const choice = useDiffUi((s) => s.legendOpen);
  const open = choice ?? !short;

  if (!open) {
    return (
      <>
        <span ref={probe} hidden />
        <button
          type="button"
          onClick={() => setDiffLegendOpen(true)}
          aria-expanded={false}
          title="Show the legend"
          aria-label="Show the diff legend"
          className="pointer-events-auto absolute bottom-2 left-2 z-10 flex h-7 max-w-[calc(100%-1rem)] items-center gap-2.5 rounded-lg border border-border bg-panel/90 px-2.5 shadow-sm backdrop-blur-sm"
        >
          {show.map((cls) => (
            <span
              key={cls}
              className={`flex items-center gap-1 font-mono text-[11px] text-muted ${
                hidden.includes(cls) ? 'opacity-40' : ''
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${CLASS_SWATCH[cls]}`} aria-hidden="true" />
              {counts[cls].toLocaleString('en-US')}
            </span>
          ))}
        </button>
      </>
    );
  }

  return (
    <>
      <span ref={probe} hidden />
      <div
        role="group"
        aria-label="Diff legend"
        className="pointer-events-auto absolute bottom-3 left-3 z-10 max-w-[calc(100%-1.5rem)] min-w-[200px] rounded-lg border border-border bg-panel/90 px-2.5 py-2 shadow-sm backdrop-blur-sm max-[640px]:bottom-2 max-[640px]:left-2"
      >
        <button
          type="button"
          onClick={() => setDiffLegendOpen(false)}
          aria-expanded
          title="Collapse the legend"
          aria-label="Collapse the diff legend"
          className="absolute -top-2.5 -right-2.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-panel text-muted shadow-sm hover:text-text"
        >
          <svg {...iconProps} width={11} height={11} strokeWidth={2.6}>
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
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
                      <span className="truncate font-mono text-[11px] text-accent">
                        {propLabel}
                      </span>
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
    </>
  );
}
