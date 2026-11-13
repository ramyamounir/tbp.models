/**
 * Edit records and identity mapping (spec multi-file-edit-diff, Phase 1 "Edit types" and
 * "Identity mapping"). The operations that produce records live in `ops.ts` (Phase 2).
 *
 * The helpers below are the only place that interprets `moves` / `addedLms` / `removedLm`.
 * Snapshots are immutable by convention: never mutate an `LmEntry`, `Map` or `ObjectGraph`
 * reachable from one.
 */
import type { LmEntry, ObjectIdIndex } from '../model/types';

export type EditKind =
  'rename' | 'duplicate' | 'delete' | 'copy' | 'addLm' | 'duplicateLm' | 'deleteLm';

export interface Snapshot {
  lms: LmEntry[];
  lmToLm: number[][];
  smToLm: number[][];
  objectIdIndex: ObjectIdIndex;
}

export interface GraphAddress {
  lmId: number;
  graphId: string;
}

export interface GraphMove {
  from: GraphAddress;
  /** null = the graph was removed by the edit. */
  to: GraphAddress | null;
}

export interface EditRecord {
  kind: EditKind;
  title: string; // "Renamed", "Copied 3 models"
  detail: string; // "021_logo_tbp → 021_logo"
  note?: string; // "LM 1 · 2 object_id references re-encoded"
  before: Snapshot;
  after: Snapshot;
  /** Address changes made by this edit. Graphs not listed keep their address. */
  moves?: GraphMove[];
  /** New lmIds appended by this edit (addLm, duplicateLm, a copy that creates LMs). */
  addedLms?: number[];
  /** lmId removed by deleteLm (set even when that LM had no graphs). */
  removedLm?: number;
  /** Green row markers: graphs created by this edit. */
  added?: GraphAddress[];
}

const sameAddress = (a: GraphAddress, b: GraphAddress) =>
  a.lmId === b.lmId && a.graphId === b.graphId;

/**
 * Maps a graph address across one record. forward = before → after (applyEdit, redo);
 * backward = after → before (undo). Returns the new address, null when the graph does not exist
 * on the other side, or undefined when the record does not list it (the address is unchanged).
 * Undefined never means "gone": callers still check existence against the new view.
 */
export function mapAddress(
  rec: EditRecord,
  addr: GraphAddress,
  direction: 'forward' | 'backward',
): GraphAddress | null | undefined {
  const moves = rec.moves;
  if (!moves) return undefined;
  if (direction === 'forward') {
    const m = moves.find((mv) => sameAddress(mv.from, addr));
    return m === undefined ? undefined : m.to === null ? null : { ...m.to };
  }
  // Backward: a removed graph never maps back onto anything, and nothing maps to it.
  const m = moves.find((mv) => mv.to !== null && sameAddress(mv.to, addr));
  return m === undefined ? undefined : { ...m.from };
}

/** Maps an LM index across one record. Returns null when that LM does not exist on the other side. */
export function mapLm(
  rec: EditRecord,
  lmId: number,
  direction: 'forward' | 'backward',
): number | null {
  const k = rec.removedLm;
  if (direction === 'forward') {
    if (k === undefined) return lmId; // appended LMs do not shift existing indices
    if (lmId === k) return null;
    return lmId > k ? lmId - 1 : lmId;
  }
  if (rec.addedLms?.includes(lmId)) return null;
  if (k !== undefined && lmId >= k) return lmId + 1;
  return lmId;
}

/** True when a move is a rename: same lmId, different graphId. */
export function isRenameMove(m: GraphMove): boolean {
  return m.to !== null && m.to.lmId === m.from.lmId && m.to.graphId !== m.from.graphId;
}
