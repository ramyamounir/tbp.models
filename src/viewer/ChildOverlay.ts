/**
 * Posed child-object cloud for an LM-channel node (spec Phase 4 "Child resolution and posed child
 * cloud"). Shared by the inspector `GlyphView` (rotation only, centered) and the viewport overlay
 * (full `childPlacement`, added to `viewer.overlayGroup`), so both show the same points.
 *
 * The pose math lives in `src/model/childPose.ts`; this module only builds and places points.
 */
import * as THREE from 'three';
import { childPlacement, childRotation, type Vec3 } from '../model/childPose';
import { isEdgeChannel } from '../model/edges';
import type { ChannelGraph, ModelFile, ObjectGraph } from '../model/types';
import {
  validateColorMode,
  validateDisplayAs,
  type ColorMode,
  type DisplayAsOptions,
} from '../state/store';
import {
  CHILD_CATEGORICAL,
  computeColoring,
  cssToRgb,
  type Coloring,
  type RGB,
  type ThemeColors,
} from './colors';
import { EdgeLayer } from './EdgeLayer';
import { graphRadius } from './PointCloudLayer';

/** Overlay pink for child clouds ("All" mode; app constant, not a theme token). */
export const CHILD_CLOUD_CSS = '#DB2777';
export const CHILD_CLOUD_MAX_POINTS = 2000;
/** Dimmed child nodes are blended this far from the background toward their (dim) color. */
const CHILD_DIM_ALPHA = 0.5;

/**
 * How the child object is drawn (inspector COLOR / DISPLAY tabs), already validated against the
 * child graph. `coloring` covers every channel of the child (`computeColoring` order).
 */
export interface ChildLook {
  mode: ColorMode;
  display: DisplayAsOptions;
  coloring: Coloring;
}

/**
 * The child's look for the user's child settings: color mode and "Display as" fall back to "All"
 * / points when the child graph cannot show them; categorical rows use the child palette and
 * "All" the overlay pink.
 */
export function childLook(
  model: ModelFile,
  child: ObjectGraph,
  mode: ColorMode,
  display: DisplayAsOptions,
  theme: ThemeColors,
): ChildLook {
  const m = validateColorMode(mode, child);
  const displayAs = validateDisplayAs(display.displayAs, child);
  return {
    mode: m,
    display: displayAs === display.displayAs ? display : { ...display, displayAs },
    coloring: computeColoring(
      model,
      child,
      m,
      { ...theme, pointDefault: cssToRgb(CHILD_CLOUD_CSS) },
      undefined,
      CHILD_CATEGORICAL,
    ),
  };
}

/**
 * Channels drawn for color mode `mode`: the SM channels (`childSourceChannels`) for "All" and
 * "SM feature", every channel for modes that color LM channels too (LM feature, channel source,
 * scalar), so their colors and legend counts show.
 */
export function childChannelsFor(child: ObjectGraph, mode: ColorMode): ChannelGraph[] {
  return mode.kind === 'all' || mode.kind === 'sm' ? childSourceChannels(child) : child.channels;
}

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

const finiteRow = (c: ChannelGraph, i: number) =>
  Number.isFinite(c.pos[3 * i]) &&
  Number.isFinite(c.pos[3 * i + 1]) &&
  Number.isFinite(c.pos[3 * i + 2]);

/**
 * Rows drawn as points: finite rows of `src` (in channel order) not in `skip` (per channel, 1 =
 * drawn as an edge instead), downsampled by stride to at most `maxPoints`. `[channel, row]` pairs.
 */
function childCloudRows(
  src: ChannelGraph[],
  maxPoints: number,
  skip?: (Uint8Array | undefined)[],
): [number, number][] {
  let total = 0;
  src.forEach((c, k) => {
    for (let i = 0; i < c.n; i++) if (skip?.[k]?.[i] !== 1 && finiteRow(c, i)) total++;
  });
  const out: [number, number][] = [];
  if (total === 0) return out;
  const stride = Math.max(1, Math.ceil(total / Math.max(1, maxPoints)));
  let j = 0; // index among drawable rows
  src.forEach((c, k) => {
    for (let i = 0; i < c.n; i++) {
      if (skip?.[k]?.[i] === 1 || !finiteRow(c, i)) continue;
      if (j++ % stride === 0) out.push([k, i]);
    }
  });
  return out;
}

/**
 * Raw (uncentered) child points: finite rows of every source channel in channel order,
 * downsampled by stride so the result has at most `maxPoints` points. Null when there are none.
 */
export function childCloudPositions(
  child: ObjectGraph,
  maxPoints = CHILD_CLOUD_MAX_POINTS,
  src: ChannelGraph[] = childSourceChannels(child),
): Float32Array | null {
  const rows = childCloudRows(src, maxPoints);
  if (rows.length === 0) return null;
  const out = new Float32Array(rows.length * 3);
  rows.forEach(([k, i], o) => out.set(src[k].pos.subarray(3 * i, 3 * i + 3), 3 * o));
  return out;
}

/** True when the child graph has at least one finite point to draw. */
export function childHasPoints(child: ObjectGraph): boolean {
  return childCloudPositions(child, 1) !== null;
}

const tmpColor = new THREE.Color();

/**
 * Child object drawn with `look` (inspector COLOR / DISPLAY), as a group in the child's raw frame:
 * colored points (≤ `maxPoints`) and, for "Display as: Edges", one segment per edge node of its
 * 2D-edge channels (those nodes get no point). Points are ordered by draw priority (dimmed first,
 * top legend row last), so with depth writes off the top row is drawn over the others. Dimmed
 * nodes are blended toward `bg` (points by `CHILD_DIM_ALPHA`, edges as in the viewport). Null when
 * nothing is drawable. The caller places it with `placeChildCloud` (viewport) or
 * `centerChildCloud` (GlyphView) and disposes it.
 */
export function buildChildObject(
  child: ObjectGraph,
  look: ChildLook,
  bg: RGB,
  maxPoints = CHILD_CLOUD_MAX_POINTS,
): THREE.Group | null {
  const group = new THREE.Group();
  group.name = 'child-cloud';
  group.matrixAutoUpdate = false;
  const src = childChannelsFor(child, look.mode);
  const coloring = src.map((c) => look.coloring.channels[child.channels.indexOf(c)]);
  const { display } = look;

  const skip: (Uint8Array | undefined)[] = [];
  if (display.displayAs === 'edges') {
    const halfLen = 0.5 * (display.edgeLengthPct / 100) * graphRadius(child);
    src.forEach((c, k) => {
      if (!isEdgeChannel(c)) return;
      const e = new EdgeLayer(c, halfLen);
      if (e.segments.count === 0) return e.dispose();
      const cc = coloring[k];
      e.setColors(cc.colors, cc.dimmed, cc.hidden, false, bg);
      e.setWidth(display.edgeWidthPx);
      group.add(e.lines);
      skip[k] = e.hiddenMask;
    });
  }

  const rows = childCloudRows(src, maxPoints, skip);
  if (rows.length > 0) {
    const order = rows
      .map((r, j) => ({ r, j, p: coloring[r[0]].priority[r[1]] }))
      .sort((a, b) => a.p - b.p || a.j - b.j);
    const positions = new Float32Array(rows.length * 3);
    const colors = new Float32Array(rows.length * 3);
    order.forEach(({ r: [k, i] }, o) => {
      positions.set(src[k].pos.subarray(3 * i, 3 * i + 3), 3 * o);
      const cc = coloring[k];
      const a = cc.dimmed[i] === 1 ? CHILD_DIM_ALPHA : 1;
      const rgb = [0, 1, 2].map((ch) => bg[ch] + (cc.colors[3 * i + ch] - bg[ch]) * a);
      // Coloring is sRGB; vertex colors are in the (linear) working color space.
      tmpColor.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      colors[3 * o] = tmpColor.r;
      colors[3 * o + 1] = tmpColor.g;
      colors[3 * o + 2] = tmpColor.b;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: display.pointSize,
        sizeAttenuation: false,
        vertexColors: true,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
      }),
    );
    points.raycast = () => {}; // overlays are never pickable
    group.add(points);
  }
  return group.children.length > 0 ? group : null;
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
