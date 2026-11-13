/**
 * Memory warning (spec multi-file-edit-diff Phase 1 "Memory warning"): the graph data held in
 * memory across all open files, counting each distinct ArrayBuffer once (edits share the typed
 * arrays of untouched graphs).
 */
import type { OpenFile } from './store';

export const MEMORY_WARN_BYTES = 512 * 2 ** 20;

/** Σ over files, graphs, channels of (pos + x) bytes, each distinct ArrayBuffer once. */
export function loadedBytes(files: readonly OpenFile[]): number {
  const seen = new Set<ArrayBufferLike>();
  let total = 0;
  const add = (a: Float64Array) => {
    if (seen.has(a.buffer)) return;
    seen.add(a.buffer);
    total += a.buffer.byteLength;
  };
  for (const f of files) {
    for (const lm of f.view.lms) {
      for (const g of lm.graphs.values()) {
        for (const c of g.channels) {
          add(c.pos);
          add(c.x);
        }
      }
    }
  }
  return total;
}
