/**
 * object_id decoding (spec Phase 2 "object_id decoding"). Monty encodes a child graph id as
 * `sum(ord(c))` (pre-v0.50) or the first 3 bytes of SHA-256 (v0.50+); the file does not say
 * which, so the per-LM index holds both. Consumers resolve ids only via `resolveObjectId`.
 */
import { sha256 } from './sha256';
import type {
  ModelFile,
  ObjectIdCandidate,
  ObjectIdEncoding,
  ObjectIdIndex,
  ObjectIdResolution,
} from './types';

/** Python `sum(ord(c) for c in name)` (UTF-16 code units; identical for ASCII ids). */
export function sumOrd(name: string): number {
  let s = 0;
  for (let k = 0; k < name.length; k++) s += name.charCodeAt(k);
  return s;
}

/** `int.from_bytes(sha256(name)[:3], 'big')`; uses `crypto.subtle` when available. */
export async function sha256_24(name: string): Promise<number> {
  const bytes = new TextEncoder().encode(name);
  const subtle = globalThis.crypto?.subtle;
  const d = subtle ? new Uint8Array(await subtle.digest('SHA-256', bytes)) : sha256(bytes);
  return (d[0] << 16) | (d[1] << 8) | d[2];
}

/** Per-LM index: lmId → encoded id → candidates (de-duplicated by `(graphId, encoding)`). */
export async function buildObjectIdIndex(lms: ModelFile['lms']): Promise<ObjectIdIndex> {
  const index: ObjectIdIndex = new Map();
  for (const lm of lms) {
    const inner = new Map<number, ObjectIdCandidate[]>();
    index.set(lm.lmId, inner);
    const add = (id: number, graphId: string, encoding: ObjectIdEncoding) => {
      let list = inner.get(id);
      if (!list) inner.set(id, (list = []));
      if (!list.some((c) => c.graphId === graphId && c.encoding === encoding))
        list.push({ graphId, encoding });
    };
    for (const graphId of lm.graphIds) {
      add(sumOrd(graphId), graphId, 'sumOrd');
      add(await sha256_24(graphId), graphId, 'sha256');
    }
  }
  return index;
}

/**
 * Resolve an `object_id` stored in channel `learning_module_<s>` against LM `s` only (never
 * other LMs, never the first of several matches).
 */
export function resolveObjectId(
  model: ModelFile,
  channel: string,
  rawId: number,
): ObjectIdResolution {
  const m = /^learning_module_(\d+)$/.exec(channel);
  const id = Math.round(rawId);
  if (!m || !Number.isFinite(rawId) || Math.abs(rawId - id) > 1e-6)
    return { status: 'unresolved', id: rawId };
  const s = Number(m[1]);
  const cands = model.objectIdIndex.get(s)?.get(id) ?? [];
  const graphIds = [...new Set(cands.map((c) => c.graphId))].sort();
  if (graphIds.length === 0) return { status: 'unresolved', id };
  if (graphIds.length === 1) {
    const c = cands.find((c) => c.encoding === 'sha256') ?? cands[0]; // same graph under both encodings: report sha256
    return { status: 'resolved', lmId: s, graphId: c.graphId, encoding: c.encoding };
  }
  return {
    status: 'ambiguous',
    lmId: s,
    candidates: graphIds.map((g) => cands.find((c) => c.graphId === g)!),
  };
}

/** Sorted unique `s` over every `learning_module_<s>` channel in LM `lmId` (display only). */
export function bottomUpSenders(model: ModelFile, lmId: number): number[] {
  const out = new Set<number>();
  const lm = model.lms[lmId];
  if (!lm) return [];
  for (const g of lm.graphs.values()) {
    for (const c of g.channels) {
      const m = /^learning_module_(\d+)$/.exec(c.channel);
      if (m) out.add(Number(m[1]));
    }
  }
  return [...out].sort((a, b) => a - b);
}
