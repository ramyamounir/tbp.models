/**
 * Posed child-object cloud for an LM-channel node (spec Phase 4 "Child resolution and posed child
 * cloud"). Shared by the inspector `GlyphView` (rotation only, centered) and the viewport overlay
 * (full `childPlacement`, added to `viewer.overlayGroup`), so both show the same points.
 *
 * The pose math lives in `src/model/childPose.ts`; this module only builds and places points.
 */
import * as THREE from 'three';
import { childPlacement, childRotation, type Vec3 } from '../model/childPose';
import type { ChannelGraph, ObjectGraph } from '../model/types';
import { cssToRgb } from './colors';

/** Overlay pink for child clouds (spec "Glyph sync"; app constant, not a theme token). */
export const CHILD_CLOUD_CSS = '#DB2777';
export const CHILD_CLOUD_MAX_POINTS = 2000;
const CHILD_POINT_PX = 2.5;

/** Pose of an LM node needed to place its child: raw position, `pose_vectors`, optional `l`. */
export interface LmNodePose {
  pos: Vec3;
  row9: ArrayLike<number>;
  locationRelModel?: Vec3;
}

/** Read the LM node pose of row `i` of an LM channel; undefined if pos/pose_vectors are unusable. */
export function lmNodePose(c: ChannelGraph, i: number): LmNodePose | undefined {
  if (!Number.isInteger(i) || i < 0 || i >= c.n) return undefined;
  const pos: Vec3 = [c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]];
  if (!pos.every(Number.isFinite)) return undefined;
  const has = (k: string) => Object.prototype.hasOwnProperty.call(c.features, k);
  if (!has('pose_vectors')) return undefined;
  const [ps, pe] = c.features.pose_vectors;
  if (pe - ps < 9) return undefined;
  const row9 = Array.from(c.x.subarray(i * c.F + ps, i * c.F + ps + 9));
  if (!row9.every(Number.isFinite)) return undefined;
  let locationRelModel: Vec3 | undefined;
  if (has('location_rel_model')) {
    const [ls, le] = c.features.location_rel_model;
    if (le - ls >= 3) {
      const l: Vec3 = [c.x[i * c.F + ls], c.x[i * c.F + ls + 1], c.x[i * c.F + ls + 2]];
      if (l.every(Number.isFinite)) locationRelModel = l;
    }
  }
  return { pos, row9, locationRelModel };
}

/** Channels feeding the child cloud: SM channels, or every channel when the child has none. */
export function childSourceChannels(child: ObjectGraph): ChannelGraph[] {
  const sm = child.channels.filter((c) => c.kind === 'sm');
  return sm.length > 0 ? sm : child.channels;
}

/**
 * Raw (uncentered) child points: finite rows of every source channel in channel order,
 * downsampled by stride so the result has at most `maxPoints` points. Null when there are none.
 */
export function childCloudPositions(
  child: ObjectGraph,
  maxPoints = CHILD_CLOUD_MAX_POINTS,
): Float32Array | null {
  const src = childSourceChannels(child);
  let total = 0;
  for (const c of src) {
    for (let i = 0; i < c.n; i++) {
      if (
        Number.isFinite(c.pos[3 * i]) &&
        Number.isFinite(c.pos[3 * i + 1]) &&
        Number.isFinite(c.pos[3 * i + 2])
      ) {
        total++;
      }
    }
  }
  if (total === 0) return null;
  const stride = Math.max(1, Math.ceil(total / Math.max(1, maxPoints)));
  const out = new Float32Array(Math.ceil(total / stride) * 3);
  let k = 0; // index among finite rows
  let o = 0;
  for (const c of src) {
    for (let i = 0; i < c.n; i++) {
      const x = c.pos[3 * i];
      const y = c.pos[3 * i + 1];
      const z = c.pos[3 * i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      if (k++ % stride !== 0) continue;
      out[o++] = x;
      out[o++] = y;
      out[o++] = z;
    }
  }
  return out.subarray(0, o);
}

/** True when the child graph has at least one finite point to draw. */
export function childHasPoints(child: ObjectGraph): boolean {
  return childCloudPositions(child, 1) !== null;
}

/**
 * Child cloud as `THREE.Points` in the child's raw frame (overlay pink, ≤ `maxPoints` points),
 * or null when the source channels have no finite rows. Caller places it with
 * `placeChildCloud` (viewport) or `centerChildCloud` (GlyphView) and disposes it.
 */
export function buildChildCloud(
  child: ObjectGraph,
  maxPoints = CHILD_CLOUD_MAX_POINTS,
): THREE.Points | null {
  const positions = childCloudPositions(child, maxPoints);
  if (!positions) return null;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const [r, g, b] = cssToRgb(CHILD_CLOUD_CSS);
  const material = new THREE.PointsMaterial({
    color: new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace),
    size: CHILD_POINT_PX,
    sizeAttenuation: false,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'child-cloud';
  points.matrixAutoUpdate = false;
  points.raycast = () => {}; // overlays are never pickable
  return points;
}

/**
 * Viewport placement: `points.matrix = childPlacement(node.pos, row9, l, child.centroid).matrix`
 * (raw child coords → raw parent model coords), `matrixAutoUpdate = false`. Returns whether the
 * placement is approximate (no `location_rel_model`).
 */
export function placeChildCloud(
  points: THREE.Object3D,
  node: LmNodePose,
  childCentroid: Vec3,
): boolean {
  const { matrix, approximate } = childPlacement(
    node.pos,
    node.row9,
    node.locationRelModel,
    childCentroid,
  );
  points.matrixAutoUpdate = false;
  points.matrix.copy(matrix);
  points.matrixWorldNeedsUpdate = true;
  return approximate;
}

/**
 * GlyphView placement: `childRotation(row9) · scale(s) · translation(−childCentroid)` so the
 * preview is centered at the origin with the same orientation as the viewport overlay. The
 * uniform `scale` (default 1) only resizes the preview to the glyph box; it does not change the
 * orientation.
 */
export function centerChildCloud(
  points: THREE.Object3D,
  row9: ArrayLike<number>,
  childCentroid: Vec3,
  scale = 1,
): void {
  const m = childRotation(row9)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale))
    .multiply(
      new THREE.Matrix4().makeTranslation(-childCentroid[0], -childCentroid[1], -childCentroid[2]),
    );
  points.matrixAutoUpdate = false;
  points.matrix.copy(m);
  points.matrixWorldNeedsUpdate = true;
}

/** Max distance of the child's cloud points from its centroid (raw units); 0.01 when degenerate. */
export function childRadius(child: ObjectGraph, positions: ArrayLike<number> | null): number {
  if (!positions) return 0.01;
  const [cx, cy, cz] = child.centroid;
  let r2 = 0;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const d =
      (positions[i] - cx) ** 2 + (positions[i + 1] - cy) ** 2 + (positions[i + 2] - cz) ** 2;
    if (d > r2) r2 = d;
  }
  const r = Math.sqrt(r2);
  return Number.isFinite(r) && r >= 1e-6 ? r : 0.01;
}
