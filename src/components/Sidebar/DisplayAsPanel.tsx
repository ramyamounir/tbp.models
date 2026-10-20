import { useMemo, type ReactNode } from 'react';
import { edgeNodeCount, isEdgeChannel } from '../../model/edges';
import {
  EDGE_LENGTH_MAX,
  EDGE_LENGTH_MIN,
  EDGE_WIDTH_MAX,
  EDGE_WIDTH_MIN,
  getGraph,
  POINT_SIZE_MAX,
  POINT_SIZE_MIN,
  useViewerStore,
  type DisplayOptions as Display,
} from '../../state/store';
import { DisplayName } from '../../util/DisplayName';

const NO_EDGE_CHANNEL =
  'No 2D-edge channel in this graph (needs an SM channel with pose_vectors, pose_fully_defined and edge_strength / coherence)';

function Option({
  checked,
  disabled,
  label,
  onSelect,
  title,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onSelect(): void;
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`py-1 ${disabled ? 'opacity-50' : ''}`} title={title}>
      <label
        className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="radio"
          name="display-as"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className={`text-[13px] ${checked ? 'font-medium text-text' : 'text-text'}`}>
          {label}
        </span>
      </label>
      {children && <div className="mt-0.5 pl-[22px]">{children}</div>}
    </div>
  );
}

const sub = 'font-mono text-[11px] text-muted';

function Slider({
  label,
  value,
  unit,
  min,
  max,
  ariaLabel,
  title,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  ariaLabel: string;
  title: string;
  onChange(v: number): void;
}) {
  return (
    <label className="block pt-1">
      <span className="flex items-center justify-between">
        <span className="text-[12px] text-text">{label}</span>
        <span className="font-mono text-[11px] text-muted">
          {value} {unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.currentTarget.value))}
        className="mt-1 w-full accent-accent"
        aria-label={ariaLabel}
        title={title}
      />
    </label>
  );
}

/**
 * "Display as": Points (every node a dot) or Edges (nodes of 2D-edge channels drawn as a segment
 * along the detected edge tangent, see src/model/edges.ts; other nodes stay dots).
 */
export function DisplayAsPanel() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const display = useViewerStore((s) => s.display);
  const setDisplay = useViewerStore((s) => s.setDisplay);
  const set = (patch: Partial<Display>) => setDisplay(patch);
  const graph = getGraph(model, lmId, graphId);
  const edgeChannels = useMemo(
    () =>
      graph
        ? graph.channels
            .filter(isEdgeChannel)
            .map((c) => ({ channel: c.channel, edges: edgeNodeCount(c), n: c.n }))
        : [],
    [graph],
  );

  if (!graph) return <p className="text-xs text-faint">—</p>;

  const canEdges = edgeChannels.length > 0;
  const edges = display.displayAs === 'edges';
  return (
    <div role="radiogroup" aria-label="Display as">
      <Option checked={!edges} label="Points" onSelect={() => setDisplay({ displayAs: 'points' })}>
        <span className={sub}>every node as a dot</span>
        {!edges && (
          <Slider
            label="Point size"
            value={display.pointSize}
            unit="px"
            min={POINT_SIZE_MIN}
            max={POINT_SIZE_MAX}
            ariaLabel="Point size (pixels)"
            title="Dot diameter in CSS pixels"
            onChange={(v) => set({ pointSize: v })}
          />
        )}
      </Option>
      <Option
        checked={edges}
        disabled={!canEdges}
        title={canEdges ? undefined : NO_EDGE_CHANNEL}
        label="Edges"
        onSelect={() => setDisplay({ displayAs: 'edges' })}
      >
        {canEdges ? (
          <div className="flex flex-col gap-1">
            {edgeChannels.map((c) => (
              <span key={c.channel} className={`${sub} flex min-w-0 items-center gap-1`}>
                <DisplayName value={c.channel} max={32} />
                <span className="shrink-0">
                  · {c.edges.toLocaleString('en-US')} / {c.n.toLocaleString('en-US')} edge nodes
                </span>
              </span>
            ))}
            {edges && (
              <>
                <Slider
                  label="Edge length"
                  value={display.edgeLengthPct}
                  unit="% of R"
                  min={EDGE_LENGTH_MIN}
                  max={EDGE_LENGTH_MAX}
                  ariaLabel="Edge length (percent of the object radius)"
                  title="Segment length relative to the object bounding-sphere radius R"
                  onChange={(v) => set({ edgeLengthPct: v })}
                />
                <Slider
                  label="Edge width"
                  value={display.edgeWidthPx}
                  unit="px"
                  min={EDGE_WIDTH_MIN}
                  max={EDGE_WIDTH_MAX}
                  ariaLabel="Edge width (pixels)"
                  title="Segment width in CSS pixels; nodes without an edge keep the point size"
                  onChange={(v) => set({ edgeWidthPx: v })}
                />
              </>
            )}
          </div>
        ) : (
          <span className={sub}>2D sensor-module edges</span>
        )}
      </Option>
    </div>
  );
}
