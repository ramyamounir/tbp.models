/**
 * Row edit markers (spec multi-file-edit-diff Phase 2 "Row markers are derived", drawn by the
 * Phase 3a GraphList): green for graphs added since the last export (duplicated or copied in),
 * amber for renamed ones. Derived from `unsavedRecords(f).records`, never stored.
 */
import { isRenameMove, mapAddress, mapLm, type EditRecord, type GraphAddress } from './types';

export type RowMarker = 'added' | 'renamed';

export const markerKey = (lmId: number, graphId: string) => `${lmId}\u0000${graphId}`;

/** Follows `addr` forward through `later`; null when a later record removed it. */
function mapForward(addr: GraphAddress, later: readonly EditRecord[]): GraphAddress | null {
  let a = addr;
  for (const r of later) {
    const m = mapAddress(r, a, 'forward');
    if (m === null) return null;
    if (m !== undefined) a = m;
  }
  return a;
}

/** `markerKey(lmId, graphId)` → marker, for every graph of the current view an unsaved record added or renamed. */
export function rowMarkers(records: readonly EditRecord[]): Map<string, RowMarker> {
  const out = new Map<string, RowMarker>();
  const renamed: string[] = [];
  records.forEach((rec, i) => {
    const later = records.slice(i + 1);
    for (const a of rec.added ?? []) {
      const m = mapForward(a, later);
      if (m) out.set(markerKey(m.lmId, m.graphId), 'added');
    }
    for (const mv of rec.moves ?? []) {
      if (!isRenameMove(mv) || mv.to === null) continue;
      const m = mapForward(mv.to, later);
      if (m) renamed.push(markerKey(m.lmId, m.graphId));
    }
  });
  // "added" wins over "renamed" (a renamed duplicate is still new).
  for (const k of renamed) if (!out.has(k)) out.set(k, 'renamed');
  return out;
}

/**
 * LM indices of the current view that an unsaved record appended (Phase 3b LM "added" dot):
 * every `addedLms` index of `records[i]`, mapped forward through `records[i+1..]` with `mapLm`
 * (`null`, i.e. the added LM was deleted later, drops it). Example: add LM 3, then delete LM 1
 * → {2}.
 */
export function addedLmMarkers(records: readonly EditRecord[]): Set<number> {
  const out = new Set<number>();
  records.forEach((rec, i) => {
    for (const k of rec.addedLms ?? []) {
      let lm: number | null = k;
      for (let j = i + 1; j < records.length && lm !== null; j++)
        lm = mapLm(records[j], lm, 'forward');
      if (lm !== null) out.add(lm);
    }
  });
  return out;
}
