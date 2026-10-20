/**
 * 2D-edge channels ("Display as: Edges"). Pure helpers: no DOM, no store, no three.js.
 *
 * Background (tbp.monty `models/two_d_sensor_module.py`, `utils/edge_detection.py`): a
 * `TwoDSensorModule` runs an edge detector on the RGB patch when `edge_strength` or `coherence`
 * is among its features. When an edge is detected, the node's `pose_vectors` are replaced by
 * `[normal, edge_tangent, edge_perp]` with `normal = [0, 0, 1]` and the tangent lying in the
 * module's local 2D (x, y) plane, and `pose_fully_defined` is set to 1. Without an edge the
 * curvature-based pose is kept and `pose_fully_defined` is 0 (the 2D SM never sets it from
 * curvature), so `pose_fully_defined == 1` on such a channel means "an edge defines this pose".
 * Locations are `[u, v, 0]`, so the stored graph is planar and the tangent (row 1 of
 * `pose_vectors`, i.e. `x[pv0+3 .. pv0+5]`) lives in the same model frame as `pos`: a segment
 * through the node along that row is the detected edge. This mirrors tbp.teleop's
 * `draw_2d_segments` (`helpers.py`), which draws edge nodes as short segments along
 * `pose_vectors[3:5]` and the remaining nodes as dots.
 *
 * Averaging inside a GridObjectModel voxel (`pose_vector_mean`) can shrink or slightly tilt the
 * stored tangent, so it is normalized for display and used as stored in 3D (tiny z components
 * are kept rather than projected).
 */
import type { ChannelGraph, ObjectGraph } from './types';

const has = (c: ChannelGraph, name: string) =>
  Object.prototype.hasOwnProperty.call(c.features, name);

/**
 * An SM channel produced by a 2D sensor module with edge detection: it maps `pose_vectors`,
 * `pose_fully_defined` and at least one of the edge-detector outputs `edge_strength` /
 * `coherence` (3D sensor modules never emit those, and a 2D module without them never detects
 * edges).
 */
export function isEdgeChannel(c: ChannelGraph): boolean {
  return (
    c.kind === 'sm' &&
    has(c, 'pose_vectors') &&
    c.features.pose_vectors[1] - c.features.pose_vectors[0] >= 9 &&
    has(c, 'pose_fully_defined') &&
    (has(c, 'edge_strength') || has(c, 'coherence'))
  );
}

export function graphHasEdgeChannel(g: ObjectGraph | undefined): boolean {
  return g !== undefined && g.channels.some(isEdgeChannel);
}

/** Minimum |tangent| for a segment to be drawn (an averaged-away tangent has no direction). */
export const MIN_TANGENT_NORM = 1e-6;

export interface EdgeSegments {
  /** Raw (uncentered) `[x0,y0,z0, x1,y1,z1]` per segment, model frame. */
  positions: Float32Array;
  /** Node row of each segment (same order as `positions`). */
  nodeIndex: Int32Array;
  /** `1` for every node that got a segment (its point is hidden in "Edges" mode). */
  hidden: Uint8Array;
  count: number;
}

/**
 * Segments for every edge node of `c`: nodes with `pose_fully_defined >= 0.5`, a finite
 * position and a finite tangent row with `|t| >= MIN_TANGENT_NORM`. Each segment runs from
 * `p − t̂·halfLen` to `p + t̂·halfLen`. Nodes without a segment keep their point.
 */
export function buildEdgeSegments(c: ChannelGraph, halfLen: number): EdgeSegments {
  const n = c.n;
  const hidden = new Uint8Array(n);
  if (!isEdgeChannel(c) || !Number.isFinite(halfLen) || halfLen <= 0) {
    return { positions: new Float32Array(0), nodeIndex: new Int32Array(0), hidden, count: 0 };
  }
  const pv0 = c.features.pose_vectors[0];
  const pf0 = c.features.pose_fully_defined[0];
  const positions = new Float32Array(n * 6);
  const nodeIndex = new Int32Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const row = i * c.F;
    if (!(c.x[row + pf0] >= 0.5)) continue;
    const px = c.pos[3 * i];
    const py = c.pos[3 * i + 1];
    const pz = c.pos[3 * i + 2];
    const tx = c.x[row + pv0 + 3];
    const ty = c.x[row + pv0 + 4];
    const tz = c.x[row + pv0 + 5];
    if (![px, py, pz, tx, ty, tz].every(Number.isFinite)) continue;
    const len = Math.hypot(tx, ty, tz);
    if (len < MIN_TANGENT_NORM) continue;
    const s = halfLen / len;
    positions[6 * k] = px - tx * s;
    positions[6 * k + 1] = py - ty * s;
    positions[6 * k + 2] = pz - tz * s;
    positions[6 * k + 3] = px + tx * s;
    positions[6 * k + 4] = py + ty * s;
    positions[6 * k + 5] = pz + tz * s;
    nodeIndex[k] = i;
    hidden[i] = 1;
    k++;
  }
  return {
    positions: positions.slice(0, k * 6),
    nodeIndex: nodeIndex.slice(0, k),
    hidden,
    count: k,
  };
}

/** Number of nodes of `c` that would be drawn as edges (see `buildEdgeSegments`). */
export function edgeNodeCount(c: ChannelGraph): number {
  return buildEdgeSegments(c, 1).count;
}
