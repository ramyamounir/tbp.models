/**
 * Comparison of two object graphs (spec multi-file-edit-diff Phase 6 "Comparison"): node
 * classes, per-property metrics, summary counts, distance histogram and structural differences.
 *
 * Pure: a function of the two graphs, their files (for object_id resolution) and the settings.
 * Feature names are file data, so every per-feature or per-property table is a `Map`.
 */
import { EXACT_EPS_M } from '../components/Inspector/activeNode';
import { resolveObjectId } from '../model/hash';
import type { ChannelGraph, ModelFile, ObjectGraph } from '../model/types';
import { diffRadius, matchChannel, type ChannelMatch, type Vec3 } from './match';
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
  compared: boolean; // false = disabled in settings or not present in both
  tol: number;
  deltaA: Float32Array; // per A node of the channel-concatenated order; NaN if unpaired / not compared there
  outside: number; // paired nodes with delta > tol
  paired: number; // paired nodes for which the property was compared
  max: number; // largest delta (0 when nothing was compared)
}

export interface ChannelDiff {
  channel: string;
  inA: boolean;
  inB: boolean;
  match?: ChannelMatch;
  classA: Uint8Array; // NodeClass per A node of this channel (empty when !inA)
  classB: Uint8Array; // NodeClass per B node of this channel (empty when !inB)
  /** One entry per property compared in this channel: 1 = A node changed in that property. */
  changedMask: Map<DiffPropertyKey, Uint8Array>;
  /** Offset of this channel's first A node in the channel-concatenated A order (deltaA). */
  offsetA: number;
}

export type StructuralKind =
  'channel-only-a' | 'channel-only-b' | 'feature-only-a' | 'feature-only-b' | 'feature-width';

export interface StructuralDiff {
  kind: StructuralKind;
  channel: string;
  feature?: string;
  detail: string;
}

export interface DiffResult {
  channels: ChannelDiff[];
  counts: { equal: number; changed: number; onlyA: number; onlyB: number; nA: number; nB: number };
  properties: PropertyResult[];
  /**
   * nearestA as % of R (metres when R < 1e-9): 16 bins over [0, max] with
   * max = max(2 * tol, p99); finite values only; values above max go in the last bin.
   */
  histogram: { bins: number[]; max: number; tol: number; unit: '%R' | 'm' };
  structural: StructuralDiff[];
  verdict: 'equal' | 'different';
  equalShareOfA: number; // equal / nA
  /** A's bounding radius R (metres) and the position tolerance in metres used for pairing. */
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
function featureNames(c: ChannelGraph): string[] {
  return Object.keys(c.features)
    .filter((k) => hasOwn(c.features, k))
    .sort((p, q) => c.features[p][0] - c.features[q][0] || (p < q ? -1 : p > q ? 1 : 0));
}

const width = (c: ChannelGraph, name: string) => c.features[name][1] - c.features[name][0];

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
    const na = Math.hypot(ax, ay, az);
    const nb = Math.hypot(bx, by, bz);
    let deg: number;
    if (na === 0 && nb === 0) deg = 0;
    else if (na === 0 || nb === 0) deg = 180;
    else {
      const cos = (ax * bx + ay * by + az * bz) / (na * nb);
      deg = Math.acos(Math.max(-1, Math.min(1, cos))) * RAD2DEG;
    }
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
 * Compares graph `a` (in file `aFile`) with graph `b` (in file `bFile`). `object_id` values are
 * resolved against each side's own file.
 */
export function diffGraphs(
  a: ObjectGraph,
  aFile: ModelFile,
  b: ObjectGraph,
  bFile: ModelFile,
  s: DiffSettings,
): DiffResult {
  const R = diffRadius(a);
  const degenerate = !(R >= DEGENERATE_RADIUS_M);
  const tolM = degenerate ? EXACT_EPS_M : Math.max((s.positionPct / 100) * R, EXACT_EPS_M);
  const cellSize = Math.max(tolM, degenerate ? 0 : R / 64);
  const posUnit: '%R' | 'm' = degenerate ? 'm' : '%R';
  const posTol = degenerate ? EXACT_EPS_M : s.positionPct;
  const posScale = degenerate ? 1 : 100 / R; // metres → reporting unit
  const offA: Vec3 = s.alignCentroids ? a.centroid : [0, 0, 0];
  const offB: Vec3 = s.alignCentroids ? b.centroid : [0, 0, 0];

  let nA = 0;
  for (const c of a.channels) nA += c.n;
  let nB = 0;
  for (const c of b.channels) nB += c.n;

  // ---- properties, in display order: position, A features, then B-only features ----------
  const props = new Map<DiffPropertyKey, PropAcc>();
  const newAcc = (
    key: DiffPropertyKey,
    label: string,
    unit: PropertyResult['unit'],
    tol: number,
    enabled: boolean,
  ): PropAcc => {
    const acc: PropAcc = {
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
    };
    props.set(key, acc);
    return acc;
  };
  newAcc('position', 'node position', posUnit, posTol, s.positionEnabled);
  const featureAcc = (name: string): PropAcc => {
    const key = featureKey(name);
    const have = props.get(key);
    if (have) return have;
    const t = featureTolerance(s, name);
    const unit = name === 'pose_vectors' ? '°' : '';
    return newAcc(key, name, unit, name === 'object_id' ? 0 : t.tol, t.enabled);
  };
  for (const c of a.channels) for (const f of featureNames(c)) featureAcc(f);
  for (const c of b.channels) for (const f of featureNames(c)) featureAcc(f);

  // ---- channels -----------------------------------------------------------------------------
  const bByName = new Map<string, ChannelGraph>();
  for (const c of b.channels) if (!bByName.has(c.channel)) bByName.set(c.channel, c);
  const aNames = new Set(a.channels.map((c) => c.channel));
  const structural: StructuralDiff[] = [];
  const channels: ChannelDiff[] = [];
  const counts = { equal: 0, changed: 0, onlyA: 0, onlyB: 0, nA, nB };
  const histValues: number[] = [];
  const seenA = new Set<string>();
  let offsetA = 0;

  for (const ca of a.channels) {
    const offset = offsetA;
    offsetA += ca.n;
    const cb = seenA.has(ca.channel) ? undefined : bByName.get(ca.channel);
    seenA.add(ca.channel);
    if (!cb) {
      const classA = new Uint8Array(ca.n).fill(NodeClass.OnlyA);
      counts.onlyA += ca.n;
      structural.push({
        kind: 'channel-only-a',
        channel: ca.channel,
        detail: `${ca.channel} only in A · ${ca.n} nodes`,
      });
      channels.push({
        channel: ca.channel,
        inA: true,
        inB: false,
        classA,
        classB: new Uint8Array(0),
        changedMask: new Map(),
        offsetA: offset,
      });
      continue;
    }

    const match = matchChannel(ca, cb, offA, offB, s.match, tolM, cellSize);
    const { pairA, pairB, nearestA } = match;
    for (let i = 0; i < ca.n; i++) {
      const v = nearestA[i];
      if (Number.isFinite(v)) histValues.push(v * posScale);
    }

    // Properties compared in this channel.
    interface Col {
      acc: PropAcc;
      metric: FeatureMetric | 'position';
      startA: number;
      startB: number;
      w: number;
      name: string;
    }
    const cols: Col[] = [];
    const pos = props.get('position')!;
    if (pos.enabled)
      cols.push({ acc: pos, metric: 'position', startA: 0, startB: 0, w: 3, name: '' });
    for (const f of featureNames(ca)) {
      if (!hasOwn(cb.features, f)) {
        structural.push({
          kind: 'feature-only-a',
          channel: ca.channel,
          feature: f,
          detail: `${f} only in A's ${ca.channel}`,
        });
        continue;
      }
      const wa = width(ca, f);
      const wb = width(cb, f);
      if (wa !== wb) {
        structural.push({
          kind: 'feature-width',
          channel: ca.channel,
          feature: f,
          detail: `${f} in ${ca.channel}: width ${wa} in A, ${wb} in B`,
        });
        continue;
      }
      const acc = featureAcc(f);
      if (!acc.enabled) continue;
      cols.push({
        acc,
        metric: metricOf(f, wa),
        startA: ca.features[f][0],
        startB: cb.features[f][0],
        w: wa,
        name: f,
      });
    }
    for (const f of featureNames(cb)) {
      if (!hasOwn(ca.features, f)) {
        structural.push({
          kind: 'feature-only-b',
          channel: ca.channel,
          feature: f,
          detail: `${f} only in B's ${ca.channel}`,
        });
      }
    }

    const changedMask = new Map<DiffPropertyKey, Uint8Array>();
    const masks: Uint8Array[] = cols.map((col) => {
      col.acc.compared = true;
      const m = new Uint8Array(ca.n);
      changedMask.set(col.acc.key, m);
      return m;
    });
    const idCacheA = new Map<number, string>();
    const idCacheB = new Map<number, string>();
    const classA = new Uint8Array(ca.n);
    const classB = new Uint8Array(cb.n);

    for (let i = 0; i < ca.n; i++) {
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
          // epsilon at a 0 % tolerance) from flagging such a pair as changed.
          if (s.match === 'nearest' && d > col.acc.tol && Number.isFinite(d)) d = col.acc.tol;
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
        acc.deltaA[offset + i] = d;
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
    for (let j = 0; j < cb.n; j++) {
      if (pairB[j] < 0) {
        classB[j] = NodeClass.OnlyB;
        counts.onlyB++;
      }
    }
    channels.push({
      channel: ca.channel,
      inA: true,
      inB: true,
      match,
      classA,
      classB,
      changedMask,
      offsetA: offset,
    });
  }

  const seenB = new Set<string>();
  for (const cb of b.channels) {
    if (aNames.has(cb.channel) || seenB.has(cb.channel)) continue;
    seenB.add(cb.channel);
    counts.onlyB += cb.n;
    structural.push({
      kind: 'channel-only-b',
      channel: cb.channel,
      detail: `${cb.channel} only in B · ${cb.n} nodes`,
    });
    channels.push({
      channel: cb.channel,
      inA: false,
      inB: true,
      classA: new Uint8Array(0),
      classB: new Uint8Array(cb.n).fill(NodeClass.OnlyB),
      changedMask: new Map(),
      offsetA,
    });
  }
  // A repeated B channel name (malformed file) is unmatched: count its nodes as only in B.
  {
    const firstB = new Set<ChannelGraph>(bByName.values());
    for (const cb of b.channels) {
      if (firstB.has(cb) || !aNames.has(cb.channel)) continue;
      counts.onlyB += cb.n;
    }
  }

  const properties: PropertyResult[] = [...props.values()].map((p) => ({
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

  const unmatched = counts.onlyA + counts.onlyB;
  const verdict =
    counts.changed === 0 && (!s.countEnabled || unmatched <= s.countTol) && structural.length === 0
      ? 'equal'
      : 'different';
  const equalShareOfA = nA > 0 ? counts.equal / nA : nB === 0 ? 1 : 0;

  return {
    channels,
    counts,
    properties,
    histogram: histogram(histValues, posTol, posUnit),
    structural,
    verdict,
    equalShareOfA,
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
