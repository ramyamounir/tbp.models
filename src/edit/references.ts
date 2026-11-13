/**
 * References between models through `object_id` (spec multi-file-edit-diff, Phase 2
 * "References"). Graphs in a higher LM store their children as `object_id` values in a
 * `learning_module_<s>` channel; every id is resolved with `resolveObjectId` and only
 * `status: 'resolved'` counts.
 */
import { resolveObjectId } from '../model/hash';
import type { ChannelGraph, ModelFile, ObjectGraph, ObjectIdEncoding } from '../model/types';
import type { GraphAddress } from './types';

export interface Referrer {
  lmId: number;
  graphId: string;
  channel: string;
  /** Nodes of that channel whose object_id is `id`. */
  nodes: number;
  encoding: ObjectIdEncoding;
  /** The stored (rounded) id that resolves to the referenced graph. */
  id: number;
}

const LM_CHANNEL = /^learning_module_(\d+)$/;

/** `s` of a `learning_module_<s>` channel name, else undefined. */
export function senderLm(channel: string): number | undefined {
  const m = LM_CHANNEL.exec(channel);
  return m ? Number(m[1]) : undefined;
}

/** The rounded id a raw object_id value stands for, or undefined (non-finite / non-integral). */
export function roundedObjectId(raw: number): number | undefined {
  if (!Number.isFinite(raw)) return undefined;
  const id = Math.round(raw);
  return Math.abs(raw - id) > 1e-6 ? undefined : id;
}

/**
 * Distinct rounded ids of a channel's object_id column, in first-occurrence order, with their
 * node counts. Empty when the channel has no object_id feature.
 */
export function objectIdBuckets(c: ChannelGraph): Map<number, number> {
  const out = new Map<number, number>();
  const range = Object.prototype.hasOwnProperty.call(c.features, 'object_id')
    ? c.features.object_id
    : undefined;
  if (!range || c.F <= 0) return out;
  const col = range[0];
  for (let i = 0; i < c.n; i++) {
    const id = roundedObjectId(c.x[i * c.F + col]);
    if (id === undefined) continue;
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

/** Graphs whose learning_module_<lmId> channel has object_id values resolving to graphId. */
export function findReferrers(model: ModelFile, lmId: number, graphId: string): Referrer[] {
  const out: Referrer[] = [];
  for (const lm of model.lms) {
    for (const parentId of lm.graphIds) {
      const g = lm.graphs.get(parentId);
      if (!g) continue;
      for (const c of g.channels) {
        if (senderLm(c.channel) !== lmId) continue;
        for (const [id, nodes] of objectIdBuckets(c)) {
          const r = resolveObjectId(model, c.channel, id);
          if (r.status === 'resolved' && r.lmId === lmId && r.graphId === graphId)
            out.push({
              lmId: lm.lmId,
              graphId: parentId,
              channel: c.channel,
              nodes,
              encoding: r.encoding,
              id,
            });
        }
      }
    }
  }
  return out;
}

/**
 * `findReferrers` for several graphs of one LM in a single scan (delete dialog): graph id →
 * referrers, with an entry (possibly empty) for every requested id.
 */
export function referrersOf(
  model: ModelFile,
  lmId: number,
  graphIds: readonly string[],
): Map<string, Referrer[]> {
  const out = new Map<string, Referrer[]>(graphIds.map((id) => [id, []]));
  if (graphIds.length === 0) return out;
  for (const lm of model.lms) {
    for (const parentId of lm.graphIds) {
      const g = lm.graphs.get(parentId);
      if (!g) continue;
      for (const c of g.channels) {
        if (senderLm(c.channel) !== lmId) continue;
        for (const [id, nodes] of objectIdBuckets(c)) {
          const r = resolveObjectId(model, c.channel, id);
          if (r.status !== 'resolved' || r.lmId !== lmId) continue;
          out.get(r.graphId)?.push({
            lmId: lm.lmId,
            graphId: parentId,
            channel: c.channel,
            nodes,
            encoding: r.encoding,
            id,
          });
        }
      }
    }
  }
  return out;
}

/** Child models (resolved only) referenced by a graph, as {lmId, graphId}; direct children. */
export function childrenOf(model: ModelFile, graph: ObjectGraph): GraphAddress[] {
  const out: GraphAddress[] = [];
  const seen = new Set<string>();
  for (const c of graph.channels) {
    const j = senderLm(c.channel);
    if (j === undefined || !model.lms[j]) continue;
    for (const id of objectIdBuckets(c).keys()) {
      const r = resolveObjectId(model, c.channel, id);
      if (r.status !== 'resolved') continue;
      const key = `${r.lmId}\u0000${r.graphId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ lmId: r.lmId, graphId: r.graphId });
    }
  }
  return out;
}

/** Transitive closure of childrenOf, cycle-safe, BFS order; the starting graphs are never returned. */
export function descendantsOf(model: ModelFile, graphs: ObjectGraph[]): GraphAddress[] {
  const key = (a: GraphAddress) => `${a.lmId}\u0000${a.graphId}`;
  const visited = new Set(graphs.map(key));
  const queue: ObjectGraph[] = graphs.slice();
  const out: GraphAddress[] = [];
  for (let q = 0; q < queue.length; q++) {
    for (const c of childrenOf(model, queue[q])) {
      const k = key(c);
      if (visited.has(k)) continue;
      visited.add(k);
      out.push(c);
      const child = model.lms[c.lmId]?.graphs.get(c.graphId);
      if (child) queue.push(child);
    }
  }
  return out;
}

export interface LmDeleteImpact {
  lmId: number;
  graphId: string;
  channel: string;
  kind: 'removed' | 'renumbered';
}

/**
 * For deleting LM k: graphs with a learning_module_j channel, j === k ("input removed") or j > k
 * ("renumbered"). Graphs of LM k itself are left out (they are deleted with it).
 */
export function lmDeleteImpact(model: ModelFile, k: number): LmDeleteImpact[] {
  const out: LmDeleteImpact[] = [];
  for (const lm of model.lms) {
    if (lm.lmId === k) continue;
    for (const graphId of lm.graphIds) {
      const g = lm.graphs.get(graphId);
      if (!g) continue;
      for (const c of g.channels) {
        const j = senderLm(c.channel);
        if (j === undefined || j < k) continue;
        out.push({
          lmId: lm.lmId,
          graphId,
          channel: c.channel,
          kind: j === k ? 'removed' : 'renumbered',
        });
      }
    }
  }
  return out;
}
