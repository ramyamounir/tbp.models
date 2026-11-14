/**
 * What the diff view draws from a `DiffResult` (spec multi-file-edit-diff Phase 7a "DiffScene" /
 * "Legend"): node classes per side under the chosen feature, the selected node's partner and
 * difference stepping. Pure.
 */
import { NodeClass, type DiffResult } from './compare';
import type { ChannelGraph } from '../model/types';
import type { DiffPropertyKey } from './settings';

export type DiffSide = 'a' | 'b';

/**
 * The feature the view colours by: `property` when it is a compared feature of `result`,
 * else 'any' (for example after a slot change removed it).
 */
export function effectiveProperty(
  result: DiffResult | undefined,
  property: 'any' | DiffPropertyKey,
): 'any' | DiffPropertyKey {
  if (property === 'any' || !result) return 'any';
  return result.properties.some((p) => p.key === property && p.compared) ? property : 'any';
}

/**
 * NodeClass per node of one side. With a feature chosen, `Changed` is kept only for nodes
 * changed in that feature (A: `changedMask`; B: through its partner); other paired nodes become
 * `Equal`.
 */
export function sideClasses(
  result: DiffResult,
  side: DiffSide,
  property: 'any' | DiffPropertyKey,
): Uint8Array {
  const src = side === 'a' ? result.classA : result.classB;
  if (property === 'any') return src;
  const mask = result.changedMask.get(property);
  const cls = new Uint8Array(src);
  for (let i = 0; i < cls.length; i++) {
    if (cls[i] !== NodeClass.Changed) continue;
    const ai = side === 'a' ? i : result.match.pairB[i];
    if (!(mask !== undefined && ai >= 0 && mask[ai] === 1)) cls[i] = NodeClass.Equal;
  }
  return cls;
}

/** Counts of the four classes under `classesA` / `classesB` (A: equal, changed, onlyA; B: onlyB). */
export function classCounts(classesA: Uint8Array, classesB: Uint8Array): Record<NodeClass, number> {
  const counts: Record<NodeClass, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (let i = 0; i < classesA.length; i++)
    if (classesA[i] !== NodeClass.OnlyB) counts[classesA[i] as NodeClass]++;
  for (let i = 0; i < classesB.length; i++)
    if (classesB[i] === NodeClass.OnlyB) counts[NodeClass.OnlyB]++;
  return counts;
}

/** Index of the partner node on the other side, or -1 when unpaired. */
export function partnerOf(result: DiffResult, side: DiffSide, index: number): number {
  const arr = side === 'a' ? result.match.pairA : result.match.pairB;
  return index >= 0 && index < arr.length ? arr[index] : -1;
}

// ---- node stepping (pure) ---------------------------------------------------------------------

/** A node of one side (the store's `DiffSelection` shape). */
export interface DiffNodeRef {
  side: DiffSide;
  index: number;
}

/**
 * The nodes "Prev / Next difference" step through: every node whose class is not `Equal`, by
 * index. A paired changed node is listed once, by its A node; unpaired B nodes are listed by
 * their B node after the A nodes.
 */
export function differenceList(result: DiffResult): DiffNodeRef[] {
  const out: DiffNodeRef[] = [];
  for (let i = 0; i < result.classA.length; i++)
    if (result.classA[i] !== NodeClass.Equal) out.push({ side: 'a', index: i });
  for (let j = 0; j < result.classB.length; j++)
    if (result.classB[j] === NodeClass.OnlyB) out.push({ side: 'b', index: j });
  return out;
}

/**
 * Position of `sel` in `list` (a paired B node counts as its A partner), or -1 when it is not a
 * difference (an equal node, or no selection).
 */
export function differencePosition(
  result: DiffResult,
  list: readonly DiffNodeRef[],
  sel: DiffNodeRef | undefined,
): number {
  if (!sel) return -1;
  let key = sel;
  if (sel.side === 'b') {
    const ai = partnerOf(result, 'b', sel.index);
    if (ai >= 0) key = { side: 'a', index: ai };
  }
  return list.findIndex((n) => n.side === key.side && n.index === key.index);
}

/**
 * The previous / next difference from `sel` (clamped, no wrap). From no selection or an equal
 * node: the first difference after it (or the first / last of the list). Undefined when there
 * is no difference at all.
 */
export function stepDifference(
  result: DiffResult,
  list: readonly DiffNodeRef[],
  sel: DiffNodeRef | undefined,
  dir: -1 | 1,
): DiffNodeRef | undefined {
  if (list.length === 0) return undefined;
  const pos = differencePosition(result, list, sel);
  if (pos >= 0) return list[Math.min(list.length - 1, Math.max(0, pos + dir))];
  if (!sel) return dir > 0 ? list[0] : list[list.length - 1];
  // An equal node: continue from its place among the A nodes.
  let ai = sel.index;
  if (sel.side === 'b') ai = Math.max(0, partnerOf(result, 'b', sel.index));
  const after = (n: DiffNodeRef) => n.side === 'b' || n.index > ai;
  if (dir > 0) return list.find(after) ?? list[list.length - 1];
  for (let k = list.length - 1; k >= 0; k--) if (!after(list[k])) return list[k];
  return list[0];
}

/** Whether `sel` names an existing node of its side's channel (else the panel shows the summary). */
export function isValidSelection(
  channelA: ChannelGraph,
  channelB: ChannelGraph,
  sel: DiffNodeRef | undefined,
): sel is DiffNodeRef {
  if (!sel) return false;
  const c = sel.side === 'a' ? channelA : channelB;
  return Number.isInteger(sel.index) && sel.index >= 0 && sel.index < c.n;
}
