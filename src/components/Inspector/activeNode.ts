/**
 * Active node and nearest-node mapping across channels (spec Phase 4 "Active node and tabs",
 * "Nearest node across channels"). Pure helpers: no DOM, no store, no three.js.
 *
 * `selection` is the clicked node; the active node is `selection` when the active tab is the
 * selection's channel, otherwise the nearest node to `selection` in the active tab's channel.
 */
import type { ChannelGraph, ObjectGraph } from '../../model/types';

export type Vec3 = [number, number, number];

export interface Selection {
  channel: string;
  index: number;
}

export interface ActiveNode {
  channel: string;
  index: number;
  /** Distance (metres) from the selection to this node; 0 for the selection itself. */
  distM: number;
}

export function findChannel(
  graph: ObjectGraph | undefined,
  name: string,
): ChannelGraph | undefined {
  return graph?.channels.find((c) => c.channel === name);
}

/** Raw (uncentered) position of row `i`, or undefined when out of range or non-finite. */
export function nodePos(c: ChannelGraph, i: number): Vec3 | undefined {
  if (!Number.isInteger(i) || i < 0 || i >= c.n) return undefined;
  const p: Vec3 = [c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]];
  return p.every(Number.isFinite) ? p : undefined;
}

/** Values of feature `name` on row `i` (a view into `x`), or undefined when unmapped. */
export function featureValues(c: ChannelGraph, i: number, name: string): Float64Array | undefined {
  if (!Object.prototype.hasOwnProperty.call(c.features, name)) return undefined;
  if (!Number.isInteger(i) || i < 0 || i >= c.n) return undefined;
  const [start, end] = c.features[name];
  return c.x.subarray(i * c.F + start, i * c.F + end);
}

/** Nearest finite row of `c` to `p` (ties → lowest index); undefined when `c` has no finite rows. */
export function nearestNode(
  c: ChannelGraph,
  p: Vec3,
): { index: number; distM: number } | undefined {
  let best = -1;
  let bestD2 = Infinity;
  const pos = c.pos;
  for (let j = 0; j < c.n; j++) {
    const dx = pos[3 * j] - p[0];
    const dy = pos[3 * j + 1] - p[1];
    const dz = pos[3 * j + 2] - p[2];
    const d2 = dx * dx + dy * dy + dz * dz;
    if (Number.isFinite(d2) && d2 < bestD2) {
      bestD2 = d2;
      best = j;
    }
  }
  return best < 0 ? undefined : { index: best, distM: Math.sqrt(bestD2) };
}

/**
 * The active node: the selection itself when `activeTab` is undefined or the selection's
 * channel; otherwise the nearest node in channel `activeTab` (undefined when that channel has
 * no finite rows, does not exist, or the selection's position is non-finite).
 */
export function activeNode(
  graph: ObjectGraph | undefined,
  selection: Selection | undefined,
  activeTab: string | undefined,
): ActiveNode | undefined {
  if (!selection) return undefined;
  if (activeTab === undefined || activeTab === selection.channel) {
    return { channel: selection.channel, index: selection.index, distM: 0 };
  }
  const own = findChannel(graph, selection.channel);
  const other = findChannel(graph, activeTab);
  const p = own && nodePos(own, selection.index);
  if (!other || !p) return undefined;
  const near = nearestNode(other, p);
  return near && { channel: activeTab, index: near.index, distM: near.distM };
}

/** Inspector tab order: the channel names of the graph, in graph order. */
export function tabOrder(graph: ObjectGraph | undefined): string[] {
  return graph ? graph.channels.map((c) => c.channel) : [];
}

/** Distance in metres → `"2.9 mm"`. */
export function formatMm(distM: number): string {
  return `${(distM * 1000).toFixed(1)} mm`;
}
