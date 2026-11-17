import { useMemo, type ReactNode } from 'react';
import type { ObjectGraph } from '../../model/types';
import {
  getGraph,
  POSE_LENGTH_MAX,
  POSE_LENGTH_MIN,
  POSE_WIDTH_MAX,
  POSE_WIDTH_MIN,
  useViewerStore,
  type PoseOptions,
  type PoseRows,
} from '../../state/store';
import { hasPoseVectors } from '../../viewer/PoseLayer';
import { KindChip } from '../Diff/parts';
import { Slider } from './DisplayAsPanel';
import { Toggle } from './DisplayOptions';

const SM_ROWS = [
  { label: 'Surface normal', color: 'var(--glyph-normal)' },
  { label: 'Curvature direction 1', color: 'var(--glyph-curv1)' },
  { label: 'Curvature direction 2', color: 'var(--glyph-curv2)' },
];
const LM_ROWS = [
  { label: 'Child x axis', color: 'var(--axis-x)' },
  { label: 'Child y axis', color: 'var(--axis-y)' },
  { label: 'Child z axis', color: 'var(--axis-z)' },
];

/** Nodes of the graph's channels of `kind` that map `pose_vectors`. */
function poseNodes(graph: ObjectGraph | undefined, kind: 'sm' | 'lm'): number {
  let n = 0;
  for (const c of graph?.channels ?? []) if (c.kind === kind && hasPoseVectors(c)) n += c.n;
  return n;
}

/** One channel kind: a switch for the whole kind and a check box per `pose_vectors` row. */
function KindGroup({
  title,
  kind,
  nodes,
  on,
  rows,
  labels,
  disabled,
  onToggle,
  onRows,
  extra,
}: {
  title: string;
  kind: 'sm' | 'lm';
  nodes: number;
  on: boolean;
  rows: PoseRows;
  labels: { label: string; color: string }[];
  disabled: boolean;
  onToggle(v: boolean): void;
  onRows(rows: PoseRows): void;
  extra?: (off: boolean) => ReactNode;
}) {
  const none = nodes === 0;
  const off = disabled || none || !on;
  return (
    <fieldset
      disabled={disabled || none}
      className={`mt-1.5 rounded-lg border border-border px-2.5 py-1.5 ${disabled || none ? 'opacity-50' : ''}`}
      title={none ? `No ${kind.toUpperCase()} channel with pose_vectors in this graph` : undefined}
    >
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => onToggle(e.currentTarget.checked)}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className="text-[13px] font-medium text-text">{title}</span>
        <KindChip kind={kind} />
        <span className="ml-auto font-mono text-[11px] text-faint">
          {none ? 'none' : nodes.toLocaleString('en-US')}
        </span>
      </label>
      <div className={`mt-1.5 flex flex-col gap-1 pl-[22px] ${off ? 'opacity-50' : ''}`}>
        {labels.map((l, k) => (
          <label key={l.label} className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={rows[k]}
              disabled={off}
              onChange={(e) => {
                const next = rows.slice() as PoseRows;
                next[k] = e.currentTarget.checked;
                onRows(next);
              }}
              className="h-3.5 w-3.5 accent-accent"
            />
            <span
              aria-hidden="true"
              className="h-[3px] w-3.5 shrink-0 rounded-full"
              style={{ background: l.color }}
            />
            <span className="text-[12px] text-text">{l.label}</span>
          </label>
        ))}
        {extra?.(off)}
      </div>
    </fieldset>
  );
}

/**
 * Sidebar POSE tab: draw the `pose_vectors` of every node of the displayed graph. Sensor (SM)
 * and learning-module (LM) channels are switched separately, each with its own choice of the
 * three vectors; one length and one width for all. Vectors of nodes hidden from the legend are hidden too.
 */
export function PosePanel() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const pose = useViewerStore((s) => s.pose);
  const setPose = useViewerStore((s) => s.setPose);
  return <PoseChoices graph={getGraph(model, lmId, graphId)} pose={pose} onChange={setPose} />;
}

/**
 * The pose-vector options for `graph` (the displayed graph in the sidebar, the child object in
 * the inspector).
 */
export function PoseChoices({
  graph,
  pose,
  onChange: set,
}: {
  graph: ObjectGraph | undefined;
  pose: PoseOptions;
  onChange(patch: Partial<PoseOptions>): void;
}) {
  const counts = useMemo(
    () => ({ sm: poseNodes(graph, 'sm'), lm: poseNodes(graph, 'lm') }),
    [graph],
  );
  return (
    <div>
      <Toggle label="Show pose vectors" checked={pose.show} onChange={(v) => set({ show: v })} />
      <KindGroup
        title="Sensor channels"
        kind="sm"
        nodes={counts.sm}
        on={pose.sm}
        rows={pose.smRows}
        labels={SM_ROWS}
        disabled={!pose.show}
        onToggle={(v) => set({ sm: v })}
        onRows={(smRows) => set({ smRows })}
        extra={(off) => (
          <label
            className="mt-0.5 flex cursor-pointer items-center gap-2 border-t border-border pt-1.5"
            title="Hide the two curvature directions of nodes whose pose_fully_defined is not set (they are arbitrary there). The surface normal is always drawn."
          >
            <input
              type="checkbox"
              checked={pose.smDefinedOnly}
              disabled={off}
              onChange={(e) => set({ smDefinedOnly: e.currentTarget.checked })}
              className="h-3.5 w-3.5 shrink-0 accent-accent"
            />
            <span className="text-[12px] text-text">Curvature: fully defined only</span>
          </label>
        )}
      />
      <KindGroup
        title="LM channels"
        kind="lm"
        nodes={counts.lm}
        on={pose.lm}
        rows={pose.lmRows}
        labels={LM_ROWS}
        disabled={!pose.show}
        onToggle={(v) => set({ lm: v })}
        onRows={(lmRows) => set({ lmRows })}
      />
      <div className={`mt-1.5 grid grid-cols-2 gap-3 ${pose.show ? '' : 'opacity-50'}`}>
        <Slider
          label="Length"
          value={pose.lengthPct}
          unit="% of R"
          min={POSE_LENGTH_MIN}
          max={POSE_LENGTH_MAX}
          ariaLabel="Pose vector length (percent of the object radius)"
          title="Vector length relative to the object bounding-sphere radius R"
          onChange={(v) => set({ lengthPct: v })}
        />
        <Slider
          label="Width"
          value={pose.widthPx}
          unit="px"
          min={POSE_WIDTH_MIN}
          max={POSE_WIDTH_MAX}
          ariaLabel="Pose vector width (pixels)"
          title="Line width in CSS pixels"
          onChange={(v) => set({ widthPx: v })}
        />
      </div>
    </div>
  );
}
