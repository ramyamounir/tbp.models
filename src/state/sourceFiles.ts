/**
 * Source-file registry (spec multi-file-edit-diff, Phase 1 "Source file registry").
 *
 * Graphs copied from another file keep that file's `origin.fileId`, and export re-reads the
 * origin file. The `File` handle on `OpenFile` disappears when that file is closed, so the
 * handles live here, in a registry that outlives `closeFile`. An entry is kept as long as some
 * open file's view or undo / redo snapshot still has a graph (or LM) that originates from it.
 * The registry holds only `File` handles, no graph data.
 */
import type { LmEntry } from '../model/types';
import type { OpenFile } from './store';

export interface SourceFile {
  file: File;
  /** OpenFile.name at open time ("model.pt (2)"). */
  name: string;
}

/** Snapshots are never mutated, so the origins of one `lms` array can be cached by identity. */
const originCache = new WeakMap<LmEntry[], Set<string>>();

/** Adds the `origin.fileId` of every graph, unreadable graph and LM of `lms` to `out`. */
export function collectOrigins(lms: LmEntry[], out: Set<string>): void {
  let ids = originCache.get(lms);
  if (!ids) {
    ids = new Set<string>();
    for (const lm of lms) {
      if (lm.origin) ids.add(lm.origin.fileId);
      for (const g of lm.graphs.values()) ids.add(g.origin.fileId);
      for (const u of lm.unreadable) ids.add(u.origin.fileId);
    }
    originCache.set(lms, ids);
  }
  for (const id of ids) out.add(id);
}

/** Every origin file id that the given files still need: own ids plus every origin.fileId in view, undo and redo snapshots. */
export function referencedSourceIds(files: readonly OpenFile[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) out.add(f.id);
  for (const f of files) {
    collectOrigins(f.view.lms, out);
    for (const rec of f.undo) {
      collectOrigins(rec.before.lms, out);
      collectOrigins(rec.after.lms, out);
    }
    for (const rec of f.redo) {
      collectOrigins(rec.before.lms, out);
      collectOrigins(rec.after.lms, out);
    }
  }
  return out;
}

/** Returns `reg` unchanged (same Map object) when nothing is removed, else a new Map without the unreferenced entries. */
export function pruneSourceFiles(
  reg: Map<string, SourceFile>,
  files: readonly OpenFile[],
): Map<string, SourceFile> {
  const keep = referencedSourceIds(files);
  let changed = false;
  for (const id of reg.keys()) {
    if (!keep.has(id)) {
      changed = true;
      break;
    }
  }
  if (!changed) return reg;
  const out = new Map<string, SourceFile>();
  for (const [id, sf] of reg) if (keep.has(id)) out.set(id, sf);
  return out;
}
