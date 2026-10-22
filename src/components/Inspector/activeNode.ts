/**
 * Active node and node matching across channels (spec Phase 4 "Active node and tabs",
 * "Nearest node across channels"). Pure helpers: no DOM, no store, no three.js.
 *
 * `selection` is the clicked node; the active node is `selection` when the active tab is the
 * selection's channel, otherwise the nearest node to `selection` in the active tab's channel,
 * provided it lies within the match radius (channels store their nodes independently, so a
 * channel may have no node at the selected location).
 */
import type { ChannelGraph, ObjectGraph } from '../../model/types';
import { graphRadius } from '../../viewer/PointCloudLayer';

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

/** Match radius in metres (raw model units) for `pct` percent of the graph's radius `R`. */
export function matchRadiusM(graph: ObjectGraph | undefined, pct: number): number {
  return graph ? (pct / 100) * graphRadius(graph) : 0;
}

/** Positions equal up to float noise count as exact matches (labelled "exact"; matched even at radius 0). */
export const EXACT_EPS_M = 1e-9;

/**
 * Nearest node of `c` to `p` if it lies within `radiusM` (metres), else undefined.
 */
export function matchedNode(
  c: ChannelGraph,
  p: Vec3,
  radiusM: number,
): { index: number; distM: number } | undefined {
  const near = nearestNode(c, p);
  return near && near.distM <= radiusM + EXACT_EPS_M ? near : undefined;
}

/**
 * The active node: the selection itself when `activeTab` is undefined or the selection's
 * channel; otherwise the nearest node in channel `activeTab` within `radiusM` metres (undefined
 * when there is none, the channel does not exist, or the selection's position is non-finite).
 */
export function activeNode(
  graph: ObjectGraph | undefined,
  selection: Selection | undefined,
  activeTab: string | undefined,
  radiusM: number,
): ActiveNode | undefined {
  if (!selection) return undefined;
  if (activeTab === undefined || activeTab === selection.channel) {
    return { channel: selection.channel, index: selection.index, distM: 0 };
  }
  const own = findChannel(graph, selection.channel);
  const other = findChannel(graph, activeTab);
  const p = own && nodePos(own, selection.index);
  if (!other || !p) return undefined;
  const near = matchedNode(other, p, radiusM);
  return near && { channel: activeTab, index: near.index, distM: near.distM };
}

/**
 * Inspector tab order: the channel names of the graph, in graph order. With `selection`, only
 * the selection's channel and channels with a node within `radiusM` of it.
 */
export function tabOrder(
  graph: ObjectGraph | undefined,
  selection?: Selection,
  radiusM = 0,
): string[] {
  if (!graph) return [];
  const own = selection && findChannel(graph, selection.channel);
  const p = own && nodePos(own, selection.index);
  return graph.channels
    .filter(
      (c) => !selection || c.channel === selection.channel || (p && matchedNode(c, p, radiusM)),
    )
    .map((c) => c.channel);
}

/** Distance in metres → `"2.9 mm"`. */
export function formatMm(distM: number): string {
  return `${(distM * 1000).toFixed(1)} mm`;
}
