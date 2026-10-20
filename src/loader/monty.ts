/**
 * Monty adapter: walks the fixed schema paths of an unpickled model.pt and builds the typed,
 * format-independent `ModelFile` (spec Phase 2 "Monty structure to walk", "Typed output",
 * "Bounds and validation" → Monty structure).
 *
 * Pickle data is read only via `own()` / `Map.get` / `map.entries()`, and typed values are
 * identified only with `instanceof` (Pickle VM invariant 5).
 *
 * Two steps so storages are read lazily: `walkModel()` (sync) locates every channel's arrays;
 * parse.ts then reads the tensor storages they reference; `buildLms()` (sync) materializes and
 * validates each graph.
 */
import type { ChannelGraph, LmEntry, ObjectGraph, UnreadableGraph } from '../model/types';
import { ParseError } from './errors';
import { NumpyArray, bytesToFloat64, checkAlloc, numpyArrayData } from './numpy';
import { Placeholder, own, type PyValue } from './pyvalue';
import { LazyTensor, type StorageRef } from './torch';

const MAX_LMS = 1024;
const LIST_DEPTH_MAX = 16;

type ArraySource = LazyTensor | NumpyArray;

interface RawChannel {
  channel: string;
  pos: ArraySource;
  x: ArraySource;
  featureMapping: PyValue | undefined;
}

interface RawGraph {
  graphId: string;
  channels: RawChannel[];
}

interface RawLm {
  lmId: number;
  graphs: RawGraph[];
  unreadable: UnreadableGraph[];
}

export interface WalkedModel {
  lms: RawLm[];
  lmToLm: number[][];
  smToLm: number[][];
}

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function keyLabel(k: PyValue): string {
  if (typeof k === 'string') return k;
  if (typeof k === 'number' || typeof k === 'boolean' || k === null) return String(k);
  return '<non-string key>';
}

function isArraySource(v: PyValue | undefined): v is ArraySource {
  return v instanceof LazyTensor || v instanceof NumpyArray;
}

/** Locate `_graph`'s arrays for one channel (NumpyGraph or legacy torch_geometric Data). */
function walkChannel(channel: string, objectModel: PyValue | undefined): RawChannel {
  const graph = own(objectModel, '_graph');
  if (graph === undefined) throw new ParseError(`channel ${channel}: no _graph`);
  const store = own(graph, '_store');
  // Legacy GraphObjectModel: Data._store (GlobalStorage)._mapping; current: NumpyGraph fields.
  const fields = store !== undefined ? own(store, '_mapping') : graph;
  if (store !== undefined && !(fields instanceof Map)) {
    throw new ParseError(`channel ${channel}: legacy graph without _mapping`);
  }
  const pos = own(fields, 'pos');
  const x = own(fields, 'x');
  if (!isArraySource(pos)) throw new ParseError(`channel ${channel}: pos is not an array`);
  if (!isArraySource(x)) throw new ParseError(`channel ${channel}: x is not an array`);
  return { channel, pos, x, featureMapping: own(fields, 'feature_mapping') };
}

/** omegaconf ListConfig / nested list → number[][] (anything else → []). */
function unwrapMatrix(v: PyValue | undefined): number[][] {
  const visited = new Set<unknown>();
  const unwrap = (node: PyValue | undefined, depth: number): unknown => {
    if (depth > LIST_DEPTH_MAX) throw new ParseError('ListConfig nesting too deep');
    if (typeof node === 'number') return node;
    if (node === null || node === undefined || typeof node !== 'object') return undefined;
    if (visited.has(node)) throw new ParseError('ListConfig cycle');
    visited.add(node);
    if (Array.isArray(node)) return node.map((e) => unwrap(e, depth + 1));
    if (node instanceof Placeholder) {
      const content = own(node, '_content');
      if (Array.isArray(content)) return unwrap(content, depth + 1);
      return unwrap(own(node, '_val'), depth + 1);
    }
    return undefined;
  };
  try {
    const out = unwrap(v, 0);
    if (
      Array.isArray(out) &&
      out.every(
        (row) =>
          Array.isArray(row) && row.every((e) => typeof e === 'number' && Number.isSafeInteger(e)),
      )
    ) {
      return out as number[][];
    }
  } catch {
    // A malformed matrix is not fatal.
  }
  return [];
}

/** Walk `root.lm_dict → [lm].graph_memory → [graphId] → [channel]`. */
export function walkModel(root: PyValue): WalkedModel {
  if (!(root instanceof Map)) throw new ParseError('Not a Monty model: root is not a dict');
  const lmDict = root.get('lm_dict');
  if (!(lmDict instanceof Map)) throw new ParseError('Not a Monty model: lm_dict');
  const byId = new Map<number, PyValue>();
  for (const [k, v] of lmDict.entries()) {
    if (typeof k !== 'number' || !Number.isSafeInteger(k) || k < 0 || k >= MAX_LMS) {
      throw new ParseError(`Not a Monty model: lm_dict key ${keyLabel(k)}`);
    }
    byId.set(k, v);
  }
  const count = byId.size === 0 ? 0 : Math.max(...byId.keys()) + 1;
  const lms: RawLm[] = [];
  for (let lmId = 0; lmId < count; lmId++) {
    const lm: RawLm = { lmId, graphs: [], unreadable: [] };
    lms.push(lm);
    if (!byId.has(lmId)) continue; // gap in lm_dict keys: empty LM keeps lms dense
    const gm = own(byId.get(lmId), 'graph_memory');
    if (!(gm instanceof Map))
      throw new ParseError(`Not a Monty model: lm_dict[${lmId}].graph_memory`);
    for (const [gk, channels] of gm.entries()) {
      if (typeof gk !== 'string') {
        lm.unreadable.push({ graphId: keyLabel(gk), reason: 'graph id is not a string' });
        continue;
      }
      try {
        if (!(channels instanceof Map))
          throw new ParseError('graph entry is not a dict of channels');
        const raw: RawChannel[] = [];
        for (const [ck, objectModel] of channels.entries()) {
          if (typeof ck !== 'string')
            throw new ParseError(`channel name ${keyLabel(ck)} is not a string`);
          raw.push(walkChannel(ck, objectModel));
        }
        if (raw.length === 0) throw new ParseError('graph has no channels');
        lm.graphs.push({ graphId: gk, channels: raw });
      } catch (err) {
        lm.unreadable.push({ graphId: gk, reason: errMessage(err) });
      }
    }
  }
  return {
    lms,
    lmToLm: unwrapMatrix(root.get('lm_to_lm_matrix')),
    smToLm: unwrapMatrix(root.get('sm_to_lm_matrix')),
  };
}

/** Storages referenced by graph `pos` / `x` tensors (the only storages that are read). */
export function referencedStorages(walked: WalkedModel): StorageRef[] {
  const out = new Set<StorageRef>();
  for (const lm of walked.lms) {
    for (const g of lm.graphs) {
      for (const c of g.channels) {
        if (c.pos instanceof LazyTensor) out.add(c.pos.storage);
        if (c.x instanceof LazyTensor) out.add(c.x.storage);
      }
    }
  }
  return [...out];
}

/** Materialize an array as `{shape, data: Float64Array}` (fresh, exactly-sized copy). */
function readArray(src: ArraySource): { shape: readonly number[]; data: Float64Array } {
  if (src instanceof LazyTensor) {
    const cls = src.storage.cls;
    return {
      shape: src.shape,
      data: bytesToFloat64(src.data(), cls.kind, cls.bytesPerElement, src.numel),
    };
  }
  const bytes = numpyArrayData(src);
  const dtype = src.dtype!; // checked by numpyArrayData
  const numel = bytes.byteLength / dtype.itemsize;
  return { shape: src.shape, data: bytesToFloat64(bytes, dtype.kind, dtype.itemsize, numel) };
}

function readFeatureMapping(
  fm: PyValue | undefined,
  channel: string,
): Map<string, [number, number]> {
  if (!(fm instanceof Map))
    throw new ParseError(`channel ${channel}: feature_mapping is not a dict`);
  const out = new Map<string, [number, number]>();
  for (const [k, v] of fm.entries()) {
    if (typeof k !== 'string')
      throw new ParseError(`channel ${channel}: feature name is not a string`);
    if (
      !Array.isArray(v) ||
      v.length !== 2 ||
      typeof v[0] !== 'number' ||
      typeof v[1] !== 'number' ||
      !Number.isSafeInteger(v[0]) ||
      !Number.isSafeInteger(v[1])
    ) {
      throw new ParseError(`channel ${channel}: feature ${k} has a malformed range`);
    }
    out.set(k, [v[0], v[1]]);
  }
  return out;
}

function buildChannel(raw: RawChannel): ChannelGraph {
  const { channel } = raw;
  const pos = readArray(raw.pos);
  const x = readArray(raw.x);
  if (pos.shape.length !== 2 || pos.shape[1] !== 3) {
    throw new ParseError(`channel ${channel}: pos shape [${pos.shape.join(', ')}] is not [n, 3]`);
  }
  const n = pos.shape[0];
  if (pos.data.length !== 3 * n)
    throw new ParseError(`channel ${channel}: pos.length ${pos.data.length} != 3*n ${3 * n}`);
  if (x.shape.length !== 2 || x.shape[0] !== n) {
    throw new ParseError(
      `channel ${channel}: x shape [${x.shape.join(', ')}] does not match ${n} nodes`,
    );
  }
  let F = x.shape[1];
  let xData = x.data;
  if (xData.length !== n * F)
    throw new ParseError(`channel ${channel}: x.length ${xData.length} != n*F ${n * F}`);

  const fm = readFeatureMapping(raw.featureMapping, channel);
  const nodeIds = fm.get('node_ids');
  if (nodeIds) {
    // Legacy: drop the leading node_ids columns and shift the ranges after it.
    const [a, b] = nodeIds;
    if (!(0 <= a && a < b && b <= F))
      throw new ParseError(`channel ${channel}: feature node_ids range out of bounds`);
    const w = b - a;
    const F2 = F - w;
    checkAlloc(n * F2);
    const out = new Float64Array(n * F2);
    for (let r = 0; r < n; r++) {
      const src = r * F;
      const dst = r * F2;
      out.set(xData.subarray(src, src + a), dst);
      out.set(xData.subarray(src + b, src + F), dst + a);
    }
    fm.delete('node_ids');
    for (const [k, [s, e]] of fm) if (s >= b) fm.set(k, [s - w, e - w]);
    xData = out;
    F = F2;
  }
  // Null-prototype record: a feature named `__proto__` / `constructor` is an ordinary own key.
  const features = Object.create(null) as Record<string, [number, number]>;
  for (const [k, [s, e]] of fm) {
    if (!(0 <= s && s < e && e <= F)) {
      throw new ParseError(`channel ${channel}: feature ${k} range [${s}, ${e}) outside [0, ${F}]`);
    }
    features[k] = [s, e];
  }
  let nonFiniteRows = 0;
  const p = pos.data;
  for (let r = 0; r < n; r++) {
    if (
      !Number.isFinite(p[3 * r]) ||
      !Number.isFinite(p[3 * r + 1]) ||
      !Number.isFinite(p[3 * r + 2])
    )
      nonFiniteRows++;
  }
  return {
    channel,
    kind: channel.startsWith('learning_module_') ? 'lm' : 'sm',
    n,
    pos: p,
    x: xData,
    F,
    features,
    nonFiniteRows,
  };
}

function centroidOf(channels: ChannelGraph[]): [number, number, number] {
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let k = 0;
  for (const c of channels) {
    const p = c.pos;
    for (let r = 0; r < c.n; r++) {
      const x = p[3 * r];
      const y = p[3 * r + 1];
      const z = p[3 * r + 2];
      if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
        sx += x;
        sy += y;
        sz += z;
        k++;
      }
    }
  }
  return k === 0 ? [0, 0, 0] : [sx / k, sy / k, sz / k];
}

/** Materialize and validate every graph; a failing graph becomes `unreadable`. */
export function buildLms(walked: WalkedModel): LmEntry[] {
  return walked.lms.map((lm) => {
    const graphs = new Map<string, ObjectGraph>();
    const graphIds: string[] = [];
    const unreadable = lm.unreadable.slice();
    for (const g of lm.graphs) {
      try {
        const channels = g.channels.map(buildChannel);
        graphs.set(g.graphId, {
          lmId: lm.lmId,
          graphId: g.graphId,
          channels,
          centroid: centroidOf(channels),
        });
        graphIds.push(g.graphId);
      } catch (err) {
        unreadable.push({ graphId: g.graphId, reason: errMessage(err) });
      }
    }
    return { lmId: lm.lmId, graphIds, graphs, unreadable };
  });
}
