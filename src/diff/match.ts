/**
 * Node pairing between two channels (spec multi-file-edit-diff Phase 6 "Matching").
 *
 * Pure and deterministic: ties always resolve to the lower B row, nothing depends on hash
 * iteration order or sort stability, and no step builds an nA × nB structure.
 */
import type { ChannelGraph, ObjectGraph } from '../model/types';
import type { MatchMode } from './settings';

export type Vec3 = readonly [number, number, number];

export interface ChannelMatch {
  /** B row paired with each A row, -1 = unpaired. */
  pairA: Int32Array;
  /** A row paired with each B row, -1 = unpaired. */
  pairB: Int32Array;
  /**
   * Distance (metres) from each A node to its nearest B node over all finite B rows ('nearest'
   * mode) or to B's row i ('index' mode). NaN for a non-finite A row (or no row i in B, index
   * mode); Infinity when B has no finite row (nearest mode).
   */
  nearestA: Float32Array;
}

const ZERO: Vec3 = [0, 0, 0];

/**
 * Largest Euclidean distance from the graph's centroid to any row with all three position
 * components finite, over all channels; 0 for a graph with no finite rows. Unlike
 * `graphRadius` (PointCloudLayer) no minimum is substituted.
 */
export function diffRadius(g: ObjectGraph): number {
  const [cx, cy, cz] = g.centroid;
  let r2 = 0;
  for (const ch of g.channels) {
    const p = ch.pos;
    for (let i = 0; i < ch.n; i++) {
      const x = p[3 * i],
        y = p[3 * i + 1],
        z = p[3 * i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const dx = x - cx,
        dy = y - cy,
        dz = z - cz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > r2) r2 = d2;
    }
  }
  return Number.isFinite(r2) ? Math.sqrt(r2) : 0;
}

/** Offset-corrected positions and the finite mask of one channel. */
function corrected(c: ChannelGraph, off: Vec3): { p: Float64Array; ok: Uint8Array } {
  const p = new Float64Array(c.n * 3);
  const ok = new Uint8Array(c.n);
  for (let i = 0; i < c.n; i++) {
    const x = c.pos[3 * i] - off[0];
    const y = c.pos[3 * i + 1] - off[1];
    const z = c.pos[3 * i + 2] - off[2];
    p[3 * i] = x;
    p[3 * i + 1] = y;
    p[3 * i + 2] = z;
    ok[i] = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z) ? 1 : 0;
  }
  return { p, ok };
}

/**
 * Rows the nearestA ring search may examine before it hands over to the KD-tree (dense cells,
 * e.g. a tolerance larger than the cloud, would otherwise make it O(nA × nB)).
 */
const RING_ROW_BUDGET = 128;
/** Candidate rows the 27-cell pairing scan may examine before it hands over to the KD-tree. */
const PAIR_ROW_BUDGET = 128;

/** The 27 neighbour cell offsets, the own cell first. */
const NEIGHBOURS: readonly (readonly [number, number, number])[] = (() => {
  const out: [number, number, number][] = [[0, 0, 0]];
  for (let dz = -1; dz <= 1; dz++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) if (dx || dy || dz) out.push([dx, dy, dz]);
  return out;
})();

/** At most this many cells per axis, so a packed cell index stays a safe integer. */
const MAX_CELLS_PER_AXIS = 1 << 17;

/** Sparse uniform grid over B's finite rows: occupied cells only, rows ascending in each cell. */
interface Grid {
  c: number;
  min: [number, number, number];
  max: [number, number, number]; // largest cell coordinate per axis
  cells: Map<number, number[]>;
  /** Per cell: index of its first row not yet known to be paired (pairing skips the prefix). */
  head: Map<number, number>;
}

function buildGrid(p: Float64Array, ok: Uint8Array, n: number, cell: number): Grid | null {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const hi: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (let j = 0; j < n; j++) {
    if (!ok[j]) continue;
    any = true;
    for (let k = 0; k < 3; k++) {
      const v = p[3 * j + k];
      if (v < min[k]) min[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  if (!any) return null;
  // A larger cell is always correct (the 27 cells still cover tolM); cap the axis cell count.
  let c = cell;
  for (let k = 0; k < 3; k++) c = Math.max(c, (hi[k] - min[k]) / (MAX_CELLS_PER_AXIS - 1));
  if (!(c > 0) || !Number.isFinite(c)) c = 1;
  const max: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) max[k] = Math.floor((hi[k] - min[k]) / c);
  const cells = new Map<number, number[]>();
  for (let j = 0; j < n; j++) {
    if (!ok[j]) continue;
    const key = packCell(
      Math.floor((p[3 * j] - min[0]) / c),
      Math.floor((p[3 * j + 1] - min[1]) / c),
      Math.floor((p[3 * j + 2] - min[2]) / c),
      max,
    );
    let list = cells.get(key);
    if (!list) cells.set(key, (list = []));
    list.push(j);
  }
  return { c, min, max, cells, head: new Map() };
}

function packCell(x: number, y: number, z: number, max: readonly number[]): number {
  return (z * (max[1] + 1) + y) * (max[0] + 1) + x;
}

/** Cell coordinate of value `v` on axis `k` (may lie outside [0, max[k]]). */
function cellOf(g: Grid, v: number, k: number): number {
  return Math.floor((v - g.min[k]) / g.c);
}

/**
 * Static 3D KD-tree over B's finite rows, used for `nearestA` of A rows too far from B's cloud
 * for the ring search (the spec's linear-scan fallback, made logarithmic so offset clouds with
 * centroid alignment off stay fast; the distance found is identical).
 */
class KdTree {
  private readonly p: Float64Array;
  /** Row of each tree slot; the node of range [lo, hi) sits at slot (lo + hi) >> 1. */
  private readonly idx: Int32Array;
  /** Tree slot of each row (-1 = not in the tree). */
  private readonly slot: Int32Array;
  /** Bounding box of each node's range, 6 values per slot (min xyz, max xyz). */
  private readonly box: Float64Array;
  /** Rows of each node's range not yet removed (pairing). */
  private readonly alive: Int32Array;
  private readonly removed: Uint8Array;

  constructor(p: Float64Array, ok: Uint8Array, n: number) {
    this.p = p;
    let m = 0;
    for (let j = 0; j < n; j++) if (ok[j]) m++;
    this.idx = new Int32Array(m);
    m = 0;
    for (let j = 0; j < n; j++) if (ok[j]) this.idx[m++] = j;
    this.box = new Float64Array(6 * m);
    this.alive = new Int32Array(m);
    this.removed = new Uint8Array(n);
    this.build(0, m, 0);
    this.slot = new Int32Array(n).fill(-1);
    for (let t = 0; t < m; t++) this.slot[this.idx[t]] = t;
  }

  private build(lo: number, hi: number, axis: number): void {
    if (hi <= lo) return;
    const p = this.p;
    const mid = (lo + hi) >> 1;
    if (hi - lo > 1) {
      this.idx.subarray(lo, hi).sort((a, b) => p[3 * a + axis] - p[3 * b + axis] || a - b);
      const next = (axis + 1) % 3;
      this.build(lo, mid, next);
      this.build(mid + 1, hi, next);
    }
    const j = this.idx[mid];
    const b = this.box;
    for (let k = 0; k < 3; k++) {
      let lo3 = p[3 * j + k];
      let hi3 = lo3;
      for (const [cl, ch] of [
        [lo, mid],
        [mid + 1, hi],
      ]) {
        if (ch <= cl) continue;
        const c = (cl + ch) >> 1;
        lo3 = Math.min(lo3, b[6 * c + k]);
        hi3 = Math.max(hi3, b[6 * c + 3 + k]);
      }
      b[6 * mid + k] = lo3;
      b[6 * mid + 3 + k] = hi3;
    }
    this.alive[mid] = hi - lo;
  }

  /** Squared distance from (x, y, z) to the bounding box of the node at `slot`. */
  private boxDist2(s: number, x: number, y: number, z: number): number {
    const b = this.box;
    const o = 6 * s;
    const dx = x < b[o] ? b[o] - x : x > b[o + 3] ? x - b[o + 3] : 0;
    const dy = y < b[o + 1] ? b[o + 1] - y : y > b[o + 4] ? y - b[o + 4] : 0;
    const dz = z < b[o + 2] ? b[o + 2] - z : z > b[o + 5] ? z - b[o + 5] : 0;
    return dx * dx + dy * dy + dz * dz;
  }

  private d2(j: number, x: number, y: number, z: number): number {
    const p = this.p;
    const dx = p[3 * j] - x,
      dy = p[3 * j + 1] - y,
      dz = p[3 * j + 2] - z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** Squared distance from (x, y, z) to the nearest row (removed rows included). */
  nearest2(x: number, y: number, z: number): number {
    let best = Infinity;
    const visit = (lo: number, hi: number): void => {
      if (hi <= lo || best === 0) return;
      const mid = (lo + hi) >> 1;
      if (this.boxDist2(mid, x, y, z) >= best) return;
      const d2 = this.d2(this.idx[mid], x, y, z);
      if (d2 < best) best = d2;
      const l = (lo + mid) >> 1;
      const r = (mid + 1 + hi) >> 1;
      const dl = mid > lo ? this.boxDist2(l, x, y, z) : Infinity;
      const dr = hi > mid + 1 ? this.boxDist2(r, x, y, z) : Infinity;
      if (dl <= dr) {
        visit(lo, mid);
        visit(mid + 1, hi);
      } else {
        visit(mid + 1, hi);
        visit(lo, mid);
      }
    };
    visit(0, this.idx.length);
    return best;
  }

  /** Nearest row not removed with squared distance <= tol2 (ties: lower row), or -1. */
  nearestAlive(x: number, y: number, z: number, tol2: number): number {
    let best = tol2;
    let bestJ = -1;
    const visit = (lo: number, hi: number): void => {
      if (hi <= lo) return;
      const mid = (lo + hi) >> 1;
      if (this.alive[mid] === 0 || this.boxDist2(mid, x, y, z) > best) return;
      const j = this.idx[mid];
      if (!this.removed[j]) {
        const d2 = this.d2(j, x, y, z);
        if (d2 < best || (d2 === best && (bestJ < 0 || j < bestJ))) {
          best = d2;
          bestJ = j;
        }
      }
      const l = (lo + mid) >> 1;
      const r = (mid + 1 + hi) >> 1;
      const dl = mid > lo ? this.boxDist2(l, x, y, z) : Infinity;
      const dr = hi > mid + 1 ? this.boxDist2(r, x, y, z) : Infinity;
      if (dl <= dr) {
        visit(lo, mid);
        visit(mid + 1, hi);
      } else {
        visit(mid + 1, hi);
        visit(lo, mid);
      }
    };
    visit(0, this.idx.length);
    return bestJ;
  }

  /** Marks row `j` removed (paired). */
  remove(j: number): void {
    const t = this.slot[j];
    if (t < 0 || this.removed[j]) return;
    this.removed[j] = 1;
    let lo = 0;
    let hi = this.idx.length;
    while (hi > lo) {
      const mid = (lo + hi) >> 1;
      this.alive[mid]--;
      if (t === mid) return;
      if (t < mid) hi = mid;
      else lo = mid + 1;
    }
  }
}

/**
 * Pairs the nodes of channel `a` with those of channel `b`. Positions are compared as
 * `posA - offA` against `posB - offB`. `tolM` is the position tolerance in metres; `cellSize`
 * (>= tolM, `diffGraphs` passes `max(tolM, R / 64)`) is the grid cell size for 'nearest'.
 */
export function matchChannel(
  a: ChannelGraph,
  b: ChannelGraph,
  offA: Vec3 = ZERO,
  offB: Vec3 = ZERO,
  mode: MatchMode = 'nearest',
  tolM = 0,
  cellSize = tolM,
): ChannelMatch {
  const nA = a.n;
  const nB = b.n;
  const pairA = new Int32Array(nA).fill(-1);
  const pairB = new Int32Array(nB).fill(-1);
  const nearestA = new Float32Array(nA);
  const A = corrected(a, offA);
  const B = corrected(b, offB);

  if (mode === 'index') {
    const m = Math.min(nA, nB);
    for (let i = 0; i < nA; i++) {
      if (i >= m) {
        nearestA[i] = NaN;
        continue;
      }
      pairA[i] = i;
      pairB[i] = i;
      const dx = A.p[3 * i] - B.p[3 * i];
      const dy = A.p[3 * i + 1] - B.p[3 * i + 1];
      const dz = A.p[3 * i + 2] - B.p[3 * i + 2];
      nearestA[i] = A.ok[i] && B.ok[i] ? Math.sqrt(dx * dx + dy * dy + dz * dz) : NaN;
    }
    return { pairA, pairB, nearestA };
  }

  const tol = Math.max(0, tolM);
  const grid = buildGrid(B.p, B.ok, nB, Math.max(cellSize, tol));
  if (!grid) {
    for (let i = 0; i < nA; i++) nearestA[i] = A.ok[i] ? Infinity : NaN;
    return { pairA, pairB, nearestA };
  }
  const tol2 = tol * tol;
  const paired = new Uint8Array(nB);
  const { max, cells, head, c } = grid;
  let finiteB = 0;
  for (let j = 0; j < nB; j++) if (B.ok[j]) finiteB++;
  const maxRings = Math.ceil(Math.cbrt(finiteB)) + 2;
  let kd: KdTree | undefined;
  /** The KD-tree over B, built on first use with the rows paired so far removed. */
  const tree = (): KdTree => {
    if (!kd) {
      kd = new KdTree(B.p, B.ok, nB);
      for (let j = 0; j < nB; j++) if (paired[j]) kd.remove(j);
    }
    return kd;
  };

  for (let i = 0; i < nA; i++) {
    if (!A.ok[i]) {
      nearestA[i] = NaN;
      continue;
    }
    const x = A.p[3 * i],
      y = A.p[3 * i + 1],
      z = A.p[3 * i + 2];
    const cx = cellOf(grid, x, 0),
      cy = cellOf(grid, y, 1),
      cz = cellOf(grid, z, 2);

    // Pairing: nearest unpaired B row within tol in the 27 surrounding cells (ties: lower row),
    // the own cell first. Dense cells (more than PAIR_ROW_BUDGET candidate rows) hand over to
    // the KD-tree, which gives the same answer.
    let bestJ = -1;
    let bestD2 = Infinity;
    let examined = 0;
    let overBudget = false;
    pairing: for (const [dx, dy, dz] of NEIGHBOURS) {
      const xx = cx + dx,
        yy = cy + dy,
        zz = cz + dz;
      if (xx < 0 || xx > max[0] || yy < 0 || yy > max[1] || zz < 0 || zz > max[2]) continue;
      const key = packCell(xx, yy, zz, max);
      const list = cells.get(key);
      if (!list) continue;
      let h = head.get(key) ?? 0;
      while (h < list.length && paired[list[h]]) h++;
      head.set(key, h);
      for (let t = h; t < list.length; t++) {
        const j = list[t];
        if (++examined > PAIR_ROW_BUDGET) {
          overBudget = true;
          break pairing;
        }
        if (paired[j]) continue;
        const ex = B.p[3 * j] - x,
          ey = B.p[3 * j + 1] - y,
          ez = B.p[3 * j + 2] - z;
        const d2 = ex * ex + ey * ey + ez * ez;
        if (d2 > tol2) continue;
        if (d2 < bestD2 || (d2 === bestD2 && j < bestJ)) {
          bestD2 = d2;
          bestJ = j;
        }
        // Rows are ascending in a cell and only the own cell can hold a coincident row, so the
        // first coincident unpaired row is the overall winner.
        if (d2 === 0) break pairing;
      }
    }
    if (overBudget) bestJ = tree().nearestAlive(x, y, z, tol2);
    if (bestJ >= 0) {
      pairA[i] = bestJ;
      pairB[bestJ] = i;
      paired[bestJ] = 1;
      kd?.remove(bestJ);
    }

    // nearestA: ring search over all finite B rows (paired or not).
    const dist0 = Math.max(
      cx < 0 ? -cx : cx > max[0] ? cx - max[0] : 0,
      cy < 0 ? -cy : cy > max[1] ? cy - max[1] : 0,
      cz < 0 ? -cz : cz > max[2] ? cz - max[2] : 0,
    );
    if (dist0 > maxRings) {
      nearestA[i] = Math.sqrt(tree().nearest2(x, y, z));
      continue;
    }
    let best2 = Infinity;
    examined = 0;
    let r = dist0; // rings closer than dist0 lie entirely outside the grid
    for (;;) {
      ringScan(grid, cx, cy, cz, r, (list) => {
        for (const j of list) {
          if (best2 === 0 || examined > RING_ROW_BUDGET) return; // cannot improve / hand over
          examined++;
          const ex = B.p[3 * j] - x,
            ey = B.p[3 * j + 1] - y,
            ez = B.p[3 * j + 2] - z;
          const d2 = ex * ex + ey * ey + ez * ez;
          if (d2 < best2) best2 = d2;
        }
      });
      if (examined > RING_ROW_BUDGET) {
        // The ring was cut short, so best2 is only an upper bound: ask the KD-tree.
        best2 = Math.min(best2, tree().nearest2(x, y, z));
        break;
      }
      const rc = r * c;
      if (best2 <= rc * rc) break;
      if (
        cx - r <= 0 &&
        cx + r >= max[0] &&
        cy - r <= 0 &&
        cy + r >= max[1] &&
        cz - r <= 0 &&
        cz + r >= max[2]
      )
        break; // the searched cube covers the whole grid
      r++;
      // Too many rings (far from B's cloud): exact KD-tree query instead of a linear scan.
      if (r > maxRings) {
        best2 = Math.min(best2, tree().nearest2(x, y, z));
        break;
      }
    }
    nearestA[i] = Math.sqrt(best2);
  }
  return { pairA, pairB, nearestA };
}

/** Calls `visit` with the rows of every occupied cell at Chebyshev cell distance exactly `r`. */
function ringScan(
  g: Grid,
  cx: number,
  cy: number,
  cz: number,
  r: number,
  visit: (rows: number[]) => void,
): void {
  const { max, cells } = g;
  const x0 = Math.max(0, cx - r),
    x1 = Math.min(max[0], cx + r);
  const y0 = Math.max(0, cy - r),
    y1 = Math.min(max[1], cy + r);
  const z0 = Math.max(0, cz - r),
    z1 = Math.min(max[2], cz + r);
  for (let x = x0; x <= x1; x++) {
    const ex = Math.abs(x - cx) === r;
    for (let y = y0; y <= y1; y++) {
      const edge = ex || Math.abs(y - cy) === r;
      if (edge) {
        for (let z = z0; z <= z1; z++) {
          const list = cells.get(packCell(x, y, z, max));
          if (list) visit(list);
        }
      } else {
        for (const z of r === 0 ? [cz] : [cz - r, cz + r]) {
          if (z < z0 || z > z1) continue;
          const list = cells.get(packCell(x, y, z, max));
          if (list) visit(list);
        }
      }
    }
  }
}
