/**
 * Natural ("natsort") ordering of graph names for display: digit runs compare as numbers, so
 * `obj_2` comes before `obj_10`. Display only: `LmEntry.graphIds` / `order` keep the on-disk
 * order, which is what export writes.
 */
import type { LmEntry } from './types';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' });

/** Natural order; names the collator treats as equal ("01" / "1") fall back to code units. */
export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/** `graphIds` arrays are never mutated (edits build new ones), so the sort is cached by identity. */
const cache = new WeakMap<string[], string[]>();

/** Readable graph ids of an LM in natural order. */
export function sortedGraphIds(lm: LmEntry): string[] {
  let out = cache.get(lm.graphIds);
  if (!out) {
    out = lm.graphIds.slice().sort(naturalCompare);
    cache.set(lm.graphIds, out);
  }
  return out;
}

/** First readable graph of an LM in natural order (undefined when it has none). */
export function firstGraphId(lm: LmEntry | undefined): string | undefined {
  return lm ? sortedGraphIds(lm)[0] : undefined;
}
