/**
 * What the diff view draws from a `DiffResult` (spec multi-file-edit-diff Phase 7a "DiffScene" /
 * "Legend"): node classes per side under the legend's property selector, which classes each
 * pane shows, the selected node's partner and the matched count. Pure.
 */
import { NodeClass, type ChannelDiff, type DiffResult } from './compare';
import type { ChannelGraph, ObjectGraph } from '../model/types';
import type { DiffPropertyKey } from './settings';

export type DiffSide = 'a' | 'b';

/**
 * The property the view colours by: `property` when it is a compared property of `result`,
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
 * NodeClass per node of one side, keyed by channel name. With a property chosen, `Changed` is
 * kept only for nodes changed in that property (A: `changedMask`; B: through its partner);
 * other paired nodes become `Equal`, and every paired node of a channel that does not compare
 * that property is `Equal`.
 */
export function sideClasses(
  result: DiffResult,
  side: DiffSide,
  property: 'any' | DiffPropertyKey,
): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  for (const ch of result.channels) {
    if (side === 'a' ? !ch.inA : !ch.inB) continue;
    if (out.has(ch.channel)) continue;
    const src = side === 'a' ? ch.classA : ch.classB;
    if (property === 'any') {
      out.set(ch.channel, src);
      continue;
    }
    const mask = ch.changedMask.get(property);
    const cls = new Uint8Array(src);
    for (let i = 0; i < cls.length; i++) {
      if (cls[i] !== NodeClass.Changed) continue;
      const ai = side === 'a' ? i : (ch.match?.pairB[i] ?? -1);
      const changed = mask !== undefined && ai >= 0 && mask[ai] === 1;
      if (!changed) cls[i] = NodeClass.Equal;
    }
    out.set(ch.channel, cls);
  }
  return out;
}

/** Counts of the four classes under `classesA` / `classesB` (A: equal, changed, onlyA; B: onlyB). */
export function classCounts(
  classesA: Map<string, Uint8Array>,
  classesB: Map<string, Uint8Array>,
): Record<NodeClass, number> {
  const counts: Record<NodeClass, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const cls of classesA.values()) {
    for (let i = 0; i < cls.length; i++)
      if (cls[i] !== NodeClass.OnlyB) counts[cls[i] as NodeClass]++;
  }
  for (const cls of classesB.values()) {
    for (let i = 0; i < cls.length; i++) if (cls[i] === NodeClass.OnlyB) counts[NodeClass.OnlyB]++;
  }
  return counts;
}

/** The channel diff of `channel` that has nodes on `side` (first one, like `sideClasses`). */
export function channelDiffOf(
  result: DiffResult,
  side: DiffSide,
  channel: string,
): ChannelDiff | undefined {
  return result.channels.find((c) => c.channel === channel && (side === 'a' ? c.inA : c.inB));
}

/** Index of the partner node on the other side, or -1 when unpaired. */
export function partnerOf(
  result: DiffResult,
  side: DiffSide,
  channel: string,
  index: number,
): number {
  const ch = channelDiffOf(result, side, channel);
  const m = ch?.match;
  if (!m || !ch.inA || !ch.inB) return -1;
  const arr = side === 'a' ? m.pairA : m.pairB;
  return index >= 0 && index < arr.length ? arr[index] : -1;
}

/** Total node count of a graph over all channels. */
export function graphNodeCount(g: ObjectGraph): number {
  return g.channels.reduce((n, c) => n + c.n, 0);
}

// ---- Phase 7b: node stepping and structure (pure) -------------------------------------------

/** A node of one side (the store's `DiffSelection` shape). */
export interface DiffNodeRef {
  side: DiffSide;
  channel: string;
  index: number;
}

/**
 * The nodes "Prev / Next difference" step through (spec Phase 7b "Node diff panel" footer):
 * every node whose class is not `Equal`, in channel order then index. A paired changed node is
 * listed once, by its A node; unpaired B nodes are listed by their B node after the channel's A
 * nodes.
 */
export function differenceList(result: DiffResult): DiffNodeRef[] {
  const out: DiffNodeRef[] = [];
  for (const ch of result.channels) {
    if (ch.inA) {
      for (let i = 0; i < ch.classA.length; i++)
        if (ch.classA[i] !== NodeClass.Equal)
          out.push({ side: 'a', channel: ch.channel, index: i });
    }
    if (ch.inB) {
      for (let j = 0; j < ch.classB.length; j++)
        if (ch.classB[j] === NodeClass.OnlyB)
          out.push({ side: 'b', channel: ch.channel, index: j });
    }
  }
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
    const ai = partnerOf(result, 'b', sel.channel, sel.index);
    if (ai >= 0) key = { side: 'a', channel: sel.channel, index: ai };
  }
  return list.findIndex(
    (n) => n.side === key.side && n.channel === key.channel && n.index === key.index,
  );
}

/**
 * The previous / next difference from `sel` (clamped, no wrap). From no selection or an equal
 * node: the first difference after it in channel order (or the first / last of the list).
 * Undefined when there is no difference at all.
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
  // An equal node: continue from its place in channel order.
  const chIdx = (c: string) => result.channels.findIndex((x) => x.channel === c);
  let ai = sel.index;
  if (sel.side === 'b') ai = Math.max(0, partnerOf(result, 'b', sel.channel, sel.index));
  const here = chIdx(sel.channel);
  const after = (n: DiffNodeRef) => {
    const k = chIdx(n.channel);
    return (
      k > here || (k === here && n.side === 'a' && n.index > ai) || (k === here && n.side === 'b')
    );
  };
  if (dir > 0) return list.find(after) ?? list[list.length - 1];
  for (let k = list.length - 1; k >= 0; k--) if (!after(list[k])) return list[k];
  return list[0];
}

/** Feature names of a channel in column order. */
export function channelFeatureNames(c: ChannelGraph): string[] {
  const own = (k: string) => Object.prototype.hasOwnProperty.call(c.features, k);
  return Object.keys(c.features)
    .filter(own)
    .sort((p, q) => c.features[p][0] - c.features[q][0] || (p < q ? -1 : p > q ? 1 : 0));
}

export interface StructureLine {
  ok: boolean;
  text: string;
}

/**
 * Structure of two graphs before or after comparing (summary STRUCTURE and the settings
 * dialog's note): for each channel present in both, whether its feature_mapping is identical
 * (names and widths), plus one line per structural difference.
 */
export function structureLines(a: ObjectGraph, b: ObjectGraph): StructureLine[] {
  const out: StructureLine[] = [];
  const nodes = (n: number) => `${n.toLocaleString('en-US')} ${n === 1 ? 'node' : 'nodes'}`;
  const bBy = new Map<string, ChannelGraph>();
  for (const c of b.channels) if (!bBy.has(c.channel)) bBy.set(c.channel, c);
  const aNames = new Set<string>();
  for (const ca of a.channels) {
    if (aNames.has(ca.channel)) continue;
    aNames.add(ca.channel);
    const cb = bBy.get(ca.channel);
    if (!cb) {
      out.push({
        ok: false,
        text: `${ca.channel} only in A · ${nodes(ca.n)}`,
      });
      continue;
    }
    const fa = channelFeatureNames(ca);
    const fb = channelFeatureNames(cb);
    const w = (c: ChannelGraph, f: string) => c.features[f][1] - c.features[f][0];
    const same =
      fa.length === fb.length &&
      fa.every(
        (f) => Object.prototype.hasOwnProperty.call(cb.features, f) && w(ca, f) === w(cb, f),
      );
    if (same) {
      out.push({
        ok: true,
        text: `feature_mapping identical · ${fa.length} ${fa.length === 1 ? 'feature' : 'features'}${
          a.channels.length > 1 || b.channels.length > 1 ? ` (${ca.channel})` : ''
        }`,
      });
    } else {
      for (const f of fa) {
        if (!Object.prototype.hasOwnProperty.call(cb.features, f))
          out.push({ ok: false, text: `${f} only in A's ${ca.channel}` });
        else if (w(ca, f) !== w(cb, f))
          out.push({
            ok: false,
            text: `${f} in ${ca.channel}: width ${w(ca, f)} in A, ${w(cb, f)} in B`,
          });
      }
      for (const f of fb)
        if (!Object.prototype.hasOwnProperty.call(ca.features, f))
          out.push({ ok: false, text: `${f} only in B's ${ca.channel}` });
    }
    out.push({ ok: true, text: `channel ${ca.channel} present in both` });
  }
  const seenB = new Set<string>();
  for (const cb of b.channels) {
    if (aNames.has(cb.channel) || seenB.has(cb.channel)) continue;
    seenB.add(cb.channel);
    out.push({
      ok: false,
      text: `${cb.channel} only in B · ${nodes(cb.n)}`,
    });
  }
  return out;
}

/** Whether `sel` names an existing node of its side's graph (else the panel shows the summary). */
export function isValidSelection(
  graphA: ObjectGraph,
  graphB: ObjectGraph,
  sel: DiffNodeRef | undefined,
): sel is DiffNodeRef {
  if (!sel) return false;
  const c = (sel.side === 'a' ? graphA : graphB).channels.find((x) => x.channel === sel.channel);
  return !!c && Number.isInteger(sel.index) && sel.index >= 0 && sel.index < c.n;
}
