/**
 * Comparison of two input channels, one per diff slot (spec multi-file-edit-diff Phase 6
 * "Comparison"): node classes, per-feature metrics, summary counts, distance histogram and the
 * feature structure (which features each channel has). The two channels may have different names
 * and kinds; only features present in both with the same width are compared.
 *
 * Pure: a function of the two channels, their files (for object_id resolution) and the settings.
 * Feature names are file data, so every per-feature or per-property table is a `Map`.
 */
import { EXACT_EPS_M } from '../components/Inspector/activeNode';
import { resolveObjectId } from '../model/hash';
import type { ChannelGraph, ModelFile } from '../model/types';
import {
  channelCentroid,
  channelRadius,
  matchChannel,
  type ChannelMatch,
  type Vec3,
} from './match';
import { featureKey, featureTolerance, type DiffPropertyKey, type DiffSettings } from './settings';

/** Node class (a const object, not an enum: the project compiles with erasableSyntaxOnly). */
export const NodeClass = { Equal: 0, Changed: 1, OnlyA: 2, OnlyB: 3 } as const;
export type NodeClass = (typeof NodeClass)[keyof typeof NodeClass];
export const NODE_CLASSES: readonly NodeClass[] = [
  NodeClass.Equal,
  NodeClass.Changed,
  NodeClass.OnlyA,
  NodeClass.OnlyB,
];

/** Below this bounding radius A has no spatial extent: positions are reported in metres. */
export const DEGENERATE_RADIUS_M = 1e-9;

export interface PropertyResult {
  key: DiffPropertyKey; // 'position' or featureKey(name), never a bare feature name
  label: string; // "node position", or the raw feature name
  unit: '%R' | 'm' | '°' | ''; // 'm' only for 'position' when R < 1e-9
  compared: boolean; // false = disabled in settings or not present in both with the same width
  tol: number;
  deltaA: Float32Array; // per A node; NaN if unpaired / not compared
  outside: number; // paired nodes with delta > tol
  paired: number; // paired nodes for which the feature was compared
  max: number; // largest delta (0 when nothing was compared)
}

/** Where a feature exists: in both channels with one width, in one only, or with two widths. */
export type FeatureStatus = 'both' | 'only-a' | 'only-b' | 'width';

/** One feature of either channel; `widthA` / `widthB` are undefined where it is absent. */
export interface FeatureStructure {
  name: string;
  widthA?: number;
  widthB?: number;
  status: FeatureStatus;
}

export interface DiffResult {
  match: ChannelMatch;
  classA: Uint8Array; // NodeClass per A node
  classB: Uint8Array; // NodeClass per B node
  /** One entry per compared feature (and 'position'): 1 = A node changed in it. */
  changedMask: Map<DiffPropertyKey, Uint8Array>;
  counts: { equal: number; changed: number; onlyA: number; onlyB: number; nA: number; nB: number };
  /** 'position', A's features in column order, then B-only features. */
  properties: PropertyResult[];
  /**
   * nearestA as % of R (metres when R < 1e-9): 16 bins over [0, max] with
   * max = max(2 * tol, p99); finite values only; values above max go in the last bin.
   */
  histogram: { bins: number[]; max: number; tol: number; unit: '%R' | 'm' };
  /** Every feature of either channel, in the order of `properties` (without 'position'). */
  structure: FeatureStructure[];
  /** Bounding radius R of A's channel (metres) and the position tolerance in metres. */
  radius: number;
  tolM: number;
}

export const HISTOGRAM_BINS = 16;

type FeatureMetric = 'pose' | 'hsv' | 'objectId' | 'abs';

interface PropAcc {
  key: DiffPropertyKey;
  label: string;
  unit: PropertyResult['unit'];
  tol: number;
  enabled: boolean;
  compared: boolean;
  deltaA: Float32Array;
  outside: number;
  paired: number;
  max: number;
}

function hasOwn(rec: Record<string, unknown>, k: string): boolean {
  return Object.prototype.hasOwnProperty.call(rec, k);
}

/** Feature names of a channel in column order (then name order for equal starts). */
export function channelFeatureNames(c: ChannelGraph): string[] {
  return Object.keys(c.features)
    .filter((k) => hasOwn(c.features, k))
    .sort((p, q) => c.features[p][0] - c.features[q][0] || (p < q ? -1 : p > q ? 1 : 0));
}

const width = (c: ChannelGraph, name: string) => c.features[name][1] - c.features[name][0];

/**
 * The features of two channels: A's in column order, then those only in B. Known before
 * comparing (settings dialog, the summary while comparing).
 */
export function featureStructure(a: ChannelGraph, b: ChannelGraph): FeatureStructure[] {
  const out: FeatureStructure[] = [];
  for (const f of channelFeatureNames(a)) {
    const widthA = width(a, f);
    if (!hasOwn(b.features, f)) {
      out.push({ name: f, widthA, status: 'only-a' });
      continue;
    }
    const widthB = width(b, f);
    out.push({ name: f, widthA, widthB, status: widthA === widthB ? 'both' : 'width' });
  }
  for (const f of channelFeatureNames(b)) {
    if (!hasOwn(a.features, f)) out.push({ name: f, widthB: width(b, f), status: 'only-b' });
  }
  return out;
}

/** Absolute difference with the NaN rule (both NaN: equal; one NaN: outside). */
function absDiff(a: number, b: number): number {
  if (a === b) return 0;
  const na = Number.isNaN(a);
  const nb = Number.isNaN(b);
  if (na && nb) return 0;
  if (na || nb) return Infinity;
  const d = Math.abs(a - b);
  return Number.isNaN(d) ? Infinity : d; // ±Infinity on both sides with opposite signs
}

const RAD2DEG = 180 / Math.PI;

/**
 * Angle (degrees) between two 3-vectors: 0 when both are zero, 180 when only one is. Computed as
 * atan2(|a×b|, a·b), which is exactly 0 for identical vectors and accurate for tiny angles (an
 * acos of the normalized dot product reads one-ulp rounding of the cosine as ~1e-6°).
 */
export function vectorAngleDeg(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): number {
  const zeroA = ax === 0 && ay === 0 && az === 0;
  const zeroB = bx === 0 && by === 0 && bz === 0;
  if (zeroA && zeroB) return 0;
  if (zeroA || zeroB) return 180;
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return Math.atan2(Math.hypot(cx, cy, cz), ax * bx + ay * by + az * bz) * RAD2DEG;
}

/** Largest angle (degrees) between corresponding 3-vectors of two rows. */
function poseDelta(xa: Float64Array, ia: number, xb: Float64Array, ib: number, w: number): number {
  let worst = 0;
  for (let v = 0; v + 3 <= w; v += 3) {
    let nanA = false,
      nanB = false,
      oneSided = false;
    for (let k = 0; k < 3; k++) {
      const a = xa[ia + v + k],
        b = xb[ib + v + k];
      const fa = Number.isFinite(a),
        fb = Number.isFinite(b);
      if (!fa) nanA = true;
      if (!fb) nanB = true;
      if (fa !== fb || (!fa && !fb && !Object.is(a, b) && !(Number.isNaN(a) && Number.isNaN(b))))
        oneSided = true;
    }
    if (oneSided) return Infinity;
    let ax = xa[ia + v],
      ay = xa[ia + v + 1],
      az = xa[ia + v + 2];
    let bx = xb[ib + v],
      by = xb[ib + v + 1],
      bz = xb[ib + v + 2];
    if (nanA || nanB) {
      // Non-finite components match on both sides: compare the finite ones only.
      if (!Number.isFinite(ax)) {
        ax = 0;
        bx = 0;
      }
      if (!Number.isFinite(ay)) {
        ay = 0;
        by = 0;
      }
      if (!Number.isFinite(az)) {
        az = 0;
        bz = 0;
      }
    }
    const deg = vectorAngleDeg(ax, ay, az, bx, by, bz);
    if (deg > worst) worst = deg;
  }
  return worst;
}

/** Largest per-component difference, the first component (hue) circular. */
function hsvDelta(xa: Float64Array, ia: number, xb: Float64Array, ib: number, w: number): number {
  let worst = 0;
  for (let k = 0; k < w; k++) {
    let d = absDiff(xa[ia + k], xb[ib + k]);
    if (k === 0 && Number.isFinite(d)) {
      d %= 1;
      d = Math.min(d, 1 - d);
    }
    if (d > worst) worst = d;
  }
  return worst;
}

function absDelta(xa: Float64Array, ia: number, xb: Float64Array, ib: number, w: number): number {
  let worst = 0;
  for (let k = 0; k < w; k++) {
    const d = absDiff(xa[ia + k], xb[ib + k]);
    if (d > worst) worst = d;
  }
  return worst;
}

/** Identity of an object_id value in its own file: resolved name, candidates, or raw id. */
function objectIdIdentity(
  file: ModelFile,
  channel: string,
  value: number,
  cache: Map<number, string>,
): string {
  const hit = cache.get(value);
  if (hit !== undefined) return hit;
  const r = resolveObjectId(file, channel, value);
  const id =
    r.status === 'resolved'
      ? `r\u0000${r.graphId}`
      : r.status === 'ambiguous'
        ? `a\u0000${r.candidates.map((c) => c.graphId).join('\u0000')}`
        : `u\u0000${Number.isNaN(r.id) ? 'NaN' : String(r.id)}`;
  cache.set(value, id);
  return id;
}

function metricOf(name: string, w: number): FeatureMetric {
  if (name === 'pose_vectors' && w % 3 === 0) return 'pose';
  if (name === 'hsv') return 'hsv';
  if (name === 'object_id') return 'objectId';
  return 'abs';
}

/** Position delta of a pair in its reporting unit (% of R, or metres when degenerate). */
function positionDelta(
  a: ChannelGraph,
  i: number,
  offA: Vec3,
  b: ChannelGraph,
  j: number,
  offB: Vec3,
  scale: number,
): number {
  let d2 = 0;
  for (let k = 0; k < 3; k++) {
    const pa = a.pos[3 * i + k] - offA[k];
    const pb = b.pos[3 * j + k] - offB[k];
    const d = absDiff(pa, pb);
    if (d === Infinity) return Infinity;
    d2 += d * d;
  }
  return Math.sqrt(d2) * scale;
}

/**
 * Compares channel `ca` (of a graph in file `aFile`) with channel `cb` (in file `bFile`).
 * `object_id` values are resolved against each side's own file and channel. The bounding radius
 * and the centroids used for alignment are those of the two channels.
 */
export function diffChannels(
  ca: ChannelGraph,
  aFile: ModelFile,
  cb: ChannelGraph,
  bFile: ModelFile,
  s: DiffSettings,
): DiffResult {
  const R = channelRadius(ca);
  const degenerate = !(R >= DEGENERATE_RADIUS_M);
  const tolM = degenerate ? EXACT_EPS_M : Math.max((s.positionPct / 100) * R, EXACT_EPS_M);
  const cellSize = Math.max(tolM, degenerate ? 0 : R / 64);
  const posUnit: '%R' | 'm' = degenerate ? 'm' : '%R';
  // A 0 % position tolerance is exact: any non-zero offset of a pair is a difference.
  const exactPos = s.positionPct === 0;
  const posTol = exactPos ? 0 : degenerate ? EXACT_EPS_M : s.positionPct;
  const posScale = degenerate ? 1 : 100 / R; // metres → reporting unit
  const offA: Vec3 = s.alignCentroids ? channelCentroid(ca) : [0, 0, 0];
  const offB: Vec3 = s.alignCentroids ? channelCentroid(cb) : [0, 0, 0];
  const nA = ca.n;
  const nB = cb.n;

  const newAcc = (
    key: DiffPropertyKey,
    label: string,
    unit: PropertyResult['unit'],
    tol: number,
    enabled: boolean,
  ): PropAcc => ({
    key,
    label,
    unit,
    tol,
    enabled,
    compared: false,
    deltaA: new Float32Array(nA).fill(NaN),
    outside: 0,
    paired: 0,
    max: 0,
  });

  interface Col {
    acc: PropAcc;
    metric: FeatureMetric | 'position';
    startA: number;
    startB: number;
    w: number;
  }
  const cols: Col[] = [];
  const pos = newAcc('position', 'node position', posUnit, posTol, s.positionEnabled);
  const props: PropAcc[] = [pos];
  if (pos.enabled) cols.push({ acc: pos, metric: 'position', startA: 0, startB: 0, w: 3 });

  const structure = featureStructure(ca, cb);
  for (const f of structure) {
    const t = featureTolerance(s, f.name);
    const acc = newAcc(
      featureKey(f.name),
      f.name,
      f.name === 'pose_vectors' ? '°' : '',
      f.name === 'object_id' ? 0 : t.tol,
      t.enabled,
    );
    props.push(acc);
    if (f.status !== 'both' || !acc.enabled) continue;
    cols.push({
      acc,
      metric: metricOf(f.name, f.widthA!),
      startA: ca.features[f.name][0],
      startB: cb.features[f.name][0],
      w: f.widthA!,
    });
  }

  const match = matchChannel(ca, cb, offA, offB, s.match, tolM, cellSize);
  const { pairA, pairB, nearestA } = match;
  const histValues: number[] = [];
  for (let i = 0; i < nA; i++) {
    const v = nearestA[i];
    if (Number.isFinite(v)) histValues.push(v * posScale);
  }

  const changedMask = new Map<DiffPropertyKey, Uint8Array>();
  const masks: Uint8Array[] = cols.map((col) => {
    col.acc.compared = true;
    const m = new Uint8Array(nA);
    changedMask.set(col.acc.key, m);
    return m;
  });
  const idCacheA = new Map<number, string>();
  const idCacheB = new Map<number, string>();
  const classA = new Uint8Array(nA);
  const classB = new Uint8Array(nB);
  const counts = { equal: 0, changed: 0, onlyA: 0, onlyB: 0, nA, nB };

  for (let i = 0; i < nA; i++) {
    const j = pairA[i];
    if (j < 0) {
      classA[i] = NodeClass.OnlyA;
      counts.onlyA++;
      continue;
    }
    let changed = false;
    for (let k = 0; k < cols.length; k++) {
      const col = cols[k];
      let d: number;
      if (col.metric === 'position') {
        d = positionDelta(ca, i, offA, cb, j, offB, posScale);
        // Nearest-in-space pairs are within the position tolerance by construction; keep a
        // rounding difference between the pairing distance and this one (or the exact-match
        // epsilon) from flagging such a pair as changed. Not at a 0 % tolerance: that one is exact.
        if (s.match === 'nearest' && !exactPos && d > col.acc.tol && Number.isFinite(d))
          d = col.acc.tol;
      } else {
        const ia = i * ca.F + col.startA;
        const ib = j * cb.F + col.startB;
        switch (col.metric) {
          case 'pose':
            d = poseDelta(ca.x, ia, cb.x, ib, col.w);
            break;
          case 'hsv':
            d = hsvDelta(ca.x, ia, cb.x, ib, col.w);
            break;
          case 'objectId': {
            d = 0;
            for (let t = 0; t < col.w; t++) {
              const va = objectIdIdentity(aFile, ca.channel, ca.x[ia + t], idCacheA);
              const vb = objectIdIdentity(bFile, cb.channel, cb.x[ib + t], idCacheB);
              if (va !== vb) {
                d = 1;
                break;
              }
            }
            break;
          }
          default:
            d = absDelta(ca.x, ia, cb.x, ib, col.w);
        }
      }
      const acc = col.acc;
      acc.deltaA[i] = d;
      acc.paired++;
      if (d > acc.max) acc.max = d;
      if (d > acc.tol) {
        acc.outside++;
        masks[k][i] = 1;
        changed = true;
      }
    }
    const cls = changed ? NodeClass.Changed : NodeClass.Equal;
    classA[i] = cls;
    classB[j] = cls;
    if (changed) counts.changed++;
    else counts.equal++;
  }
  for (let j = 0; j < nB; j++) {
    if (pairB[j] < 0) {
      classB[j] = NodeClass.OnlyB;
      counts.onlyB++;
    }
  }

  const properties: PropertyResult[] = props.map((p) => ({
    key: p.key,
    label: p.label,
    unit: p.unit,
    compared: p.compared,
    tol: p.tol,
    deltaA: p.deltaA,
    outside: p.outside,
    paired: p.paired,
    max: p.max,
  }));

  return {
    match,
    classA,
    classB,
    changedMask,
    counts,
    properties,
    histogram: histogram(histValues, posTol, posUnit),
    structure,
    radius: R,
    tolM,
  };
}

function histogram(values: number[], tol: number, unit: '%R' | 'm'): DiffResult['histogram'] {
  const bins = new Array<number>(HISTOGRAM_BINS).fill(0);
  let p99 = 0;
  if (values.length > 0) {
    const sorted = Float64Array.from(values).sort();
    p99 = sorted[Math.floor(0.99 * (sorted.length - 1))];
  }
  let max = Math.max(2 * tol, p99);
  if (!(max > 0)) max = unit === 'm' ? 2 * EXACT_EPS_M : 1;
  for (const v of values) {
    const k = Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((v / max) * HISTOGRAM_BINS)));
    bins[k]++;
  }
  return { bins, max, tol, unit };
}
