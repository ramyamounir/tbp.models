import type { ChannelGraph } from '../../model/types';
import { featureValues } from './activeNode';
import { ColorTarget } from './ColorTarget';
import { colorRow, genericRow, name, poseRowLabels, type RowSpec } from './featureRows';
import { fmt, fmtVec, orthoError } from './format';

export function Table({ rows }: { rows: RowSpec[] }) {
  if (rows.length === 0)
    return <p className="px-2 py-3 text-[12px] text-faint">No mapped features.</p>;
  return (
    <div className="overflow-hidden rounded-md">
      {rows.map((r, i) => (
        <div
          key={r.key}
          className={`grid grid-cols-[132px_1fr] gap-2 px-2.5 py-1.5 font-mono text-[12px] ${
            i % 2 === 0 ? 'bg-row-alt' : 'bg-panel'
          }`}
        >
          <div className="min-w-0 text-muted">
            <div className="flex min-w-0 items-center">{r.label}</div>
            {r.sub && (
              <div className="mt-0.5 font-sans text-[10px] leading-tight text-faint">{r.sub}</div>
            )}
          </div>
          <div className="min-w-0 break-words text-text">{r.value}</div>
        </div>
      ))}
    </div>
  );
}

const SM_ORDER = [
  'pose_vectors',
  'hsv',
  'rgba',
  'principal_curvatures',
  'principal_curvatures_log',
  'object_coverage',
  'on_object',
  'pose_fully_defined',
];

/** Feature names of `c` in display order: `order` first (when mapped), then the rest in mapping order. */
function ordered(c: ChannelGraph, order: string[]): string[] {
  const all = Object.keys(c.features);
  const has = (k: string) => Object.prototype.hasOwnProperty.call(c.features, k);
  return [...order.filter(has), ...all.filter((k) => !order.includes(k))];
}

const ORTHO_WARN = 1e-2;

export function OrthoWarning({ row9 }: { row9: ArrayLike<number> }) {
  const err = orthoError(row9);
  if (err <= ORTHO_WARN) return null;
  return (
    <span
      className="ml-1 text-select"
      title={`pose_vectors rows are not orthonormal (max |R·Rᵀ − I| = ${fmt(err)}); shown normalized in the glyph`}
    >
      ⚠
    </span>
  );
}

/** SM-channel feature table (spec Phase 4 "SM feature table"). */
export function SmFeatureTable({ channel: c, index: i }: { channel: ChannelGraph; index: number }) {
  const rows: RowSpec[] = [];
  const poseLabels = poseRowLabels(c);
  for (const f of ordered(c, SM_ORDER)) {
    if (f === 'pose_vectors') {
      const v = featureValues(c, i, f)!;
      if (v.length === 9) {
        poseLabels.forEach((label, k) =>
          rows.push({
            key: `pv${k}`,
            label: (
              <span>
                {label}
                {k === 0 && <OrthoWarning row9={v} />}
              </span>
            ),
            value: fmtVec(v.subarray(3 * k, 3 * k + 3)),
          }),
        );
        continue;
      }
    }
    const row = f === 'hsv' || f === 'rgba' ? colorRow(c, i, f) : genericRow(c, i, f);
    if (row) rows.push(row);
  }
  return <Table rows={rows} />;
}

/** The 3×3 `pose_vectors` matrix of an LM node (rows = child x, y, z in the parent frame). */
export function PoseMatrix({ row9 }: { row9: ArrayLike<number> }) {
  return (
    <div className="grid grid-cols-3 gap-x-2 text-right">
      {Array.from({ length: 9 }, (_, k) => (
        <span key={k}>{fmt(row9[k])}</span>
      ))}
    </div>
  );
}

export function ColorTargetName({ feature }: { feature: string }) {
  return (
    <ColorTarget name={feature} component={0}>
      {name(feature)}
    </ColorTarget>
  );
}
