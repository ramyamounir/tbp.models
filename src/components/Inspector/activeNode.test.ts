import { describe, expect, it } from 'vitest';
import type { ChannelGraph, ObjectGraph } from '../../model/types';
import { activeNode, formatMm, nearestNode } from './activeNode';

function ch(name: string, pts: number[][]): ChannelGraph {
  return {
    channel: name,
    kind: name.startsWith('patch') ? 'sm' : 'lm',
    n: pts.length,
    pos: Float64Array.from(pts.flat()),
    x: new Float64Array(0),
    F: 0,
    features: {},
    nonFiniteRows: 0,
  };
}

const g: ObjectGraph = {
  lmId: 1,
  graphId: 'g',
  centroid: [0, 0, 0],
  channels: [
    ch('patch_1', [
      [0, 0, 0],
      [0.01, 0, 0],
    ]),
    ch('learning_module_0', [
      [NaN, 0, 0],
      [0.012, 0.0, 0.0],
      [0.012, 0.0, 0.0],
      [0.003, 0.0, 0.0],
    ]),
    ch('learning_module_2', [[NaN, NaN, NaN]]),
  ],
};

describe('activeNode', () => {
  it('is the selection when the tab is its own channel or undefined', () => {
    const sel = { channel: 'patch_1', index: 1 };
    expect(activeNode(g, sel, undefined)).toEqual({ channel: 'patch_1', index: 1, distM: 0 });
    expect(activeNode(g, sel, 'patch_1')).toEqual({ channel: 'patch_1', index: 1, distM: 0 });
    expect(activeNode(g, undefined, 'patch_1')).toBeUndefined();
  });

  it('maps to the nearest finite node in another channel, ties to the lowest index', () => {
    const a = activeNode(g, { channel: 'patch_1', index: 1 }, 'learning_module_0')!;
    expect(a.channel).toBe('learning_module_0');
    expect(a.index).toBe(1);
    expect(a.distM).toBeCloseTo(0.002, 12);
    expect(activeNode(g, { channel: 'patch_1', index: 0 }, 'learning_module_0')!.index).toBe(3);
  });

  it('is undefined for a channel without finite rows', () => {
    expect(activeNode(g, { channel: 'patch_1', index: 0 }, 'learning_module_2')).toBeUndefined();
    expect(nearestNode(g.channels[2], [0, 0, 0])).toBeUndefined();
  });

  it('formats distances in mm', () => {
    expect(formatMm(0.0029)).toBe('2.9 mm');
  });
});
