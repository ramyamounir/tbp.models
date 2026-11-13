import { describe, expect, it } from 'vitest';
import type { ChannelGraph, ModelFile, ObjectGraph } from '../model/types';
import { testOrigin } from '../loader/testFixture';
import { diffGraphs } from './compare';
import { DEFAULT_DIFF_SETTINGS } from './settings';
import {
  differenceList,
  differencePosition,
  isValidSelection,
  stepDifference,
  structureLines,
} from './viewClasses';

function channel(name: string, pos: number[][], hsv?: number[][]): ChannelGraph {
  const n = pos.length;
  const F = hsv ? 3 : 0;
  return {
    channel: name,
    kind: name.startsWith('learning_module_') ? 'lm' : 'sm',
    n,
    pos: Float64Array.from(pos.flat()),
    x: Float64Array.from(hsv ? hsv.flat() : []),
    F,
    features: hsv ? { hsv: [0, 3] } : {},
    nonFiniteRows: 0,
  };
}

function graph(id: string, channels: ChannelGraph[]): ObjectGraph {
  let sx = 0,
    sy = 0,
    sz = 0,
    n = 0;
  for (const c of channels)
    for (let i = 0; i < c.n; i++) {
      sx += c.pos[3 * i];
      sy += c.pos[3 * i + 1];
      sz += c.pos[3 * i + 2];
      n++;
    }
  return {
    lmId: 0,
    graphId: id,
    channels,
    centroid: n ? [sx / n, sy / n, sz / n] : [0, 0, 0],
    origin: testOrigin(),
    patches: [],
  };
}

function file(): ModelFile {
  return {
    fileName: 'm.pt',
    byteLength: 0,
    lms: [],
    lmToLm: [],
    smToLm: [],
    objectIdIndex: new Map(),
  };
}

const P = [
  [0, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

describe('difference stepping', () => {
  const a = graph('a', [
    channel('patch', P, [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ]),
  ]);
  // Row 1 changed in hsv, row 3 moved away (only A / only B).
  const b = graph('b', [
    channel(
      'patch',
      [P[0], P[1], P[2], [5, 5, 5]],
      [
        [0, 0, 0],
        [0, 0.9, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    ),
  ]);
  const s = { ...DEFAULT_DIFF_SETTINGS, alignCentroids: false };
  const r = diffGraphs(a, file(), b, file(), s);

  it('lists non-equal nodes in channel order', () => {
    expect(differenceList(r)).toEqual([
      { side: 'a', channel: 'patch', index: 1 },
      { side: 'a', channel: 'patch', index: 3 },
      { side: 'b', channel: 'patch', index: 3 },
    ]);
  });

  it('steps from nothing, from a difference and from an equal node', () => {
    const list = differenceList(r);
    expect(stepDifference(r, list, undefined, 1)).toEqual(list[0]);
    expect(stepDifference(r, list, undefined, -1)).toEqual(list[2]);
    expect(stepDifference(r, list, list[0], 1)).toEqual(list[1]);
    expect(stepDifference(r, list, list[2], 1)).toEqual(list[2]);
    expect(stepDifference(r, list, { side: 'a', channel: 'patch', index: 2 }, 1)).toEqual(list[1]);
    expect(stepDifference(r, list, { side: 'a', channel: 'patch', index: 2 }, -1)).toEqual(list[0]);
    // A paired B node counts as its A partner.
    expect(differencePosition(r, list, { side: 'b', channel: 'patch', index: 1 })).toBe(0);
  });

  it('validates selections', () => {
    expect(isValidSelection(a, b, { side: 'a', channel: 'patch', index: 3 })).toBe(true);
    expect(isValidSelection(a, b, { side: 'b', channel: 'patch', index: 4 })).toBe(false);
    expect(isValidSelection(a, b, { side: 'a', channel: 'nope', index: 0 })).toBe(false);
  });
});

describe('structureLines', () => {
  it('reports identical mappings and channels present in one model only', () => {
    const a = graph('a', [
      channel(
        'patch',
        P,
        P.map(() => [0, 0, 0]),
      ),
    ]);
    const b = graph('b', [
      channel(
        'patch',
        P,
        P.map(() => [0, 0, 0]),
      ),
      channel('learning_module_0', [[0, 0, 0]]),
    ]);
    expect(structureLines(a, b)).toEqual([
      { ok: true, text: 'feature_mapping identical · 1 feature (patch)' },
      { ok: true, text: 'channel patch present in both' },
      { ok: false, text: 'learning_module_0 only in B · 1 node' },
    ]);
  });
});
