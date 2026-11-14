import { describe, expect, it } from 'vitest';
import type { ChannelGraph, ModelFile } from '../model/types';
import { diffChannels, featureStructure } from './compare';
import { DEFAULT_DIFF_SETTINGS } from './settings';
import {
  classCounts,
  differenceList,
  differencePosition,
  isValidSelection,
  sideClasses,
  stepDifference,
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
  const a = channel('patch', P, [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ]);
  // Row 1 changed in hsv, row 3 moved away (only A / only B).
  const b = channel(
    'patch',
    [P[0], P[1], P[2], [5, 5, 5]],
    [
      [0, 0, 0],
      [0, 0.9, 0],
      [0, 0, 0],
      [0, 0, 0],
    ],
  );
  const s = { ...DEFAULT_DIFF_SETTINGS, alignCentroids: false };
  const r = diffChannels(a, file(), b, file(), s);

  it('lists non-equal nodes by index, unpaired B nodes last', () => {
    expect(differenceList(r)).toEqual([
      { side: 'a', index: 1 },
      { side: 'a', index: 3 },
      { side: 'b', index: 3 },
    ]);
  });

  it('steps from nothing, from a difference and from an equal node', () => {
    const list = differenceList(r);
    expect(stepDifference(r, list, undefined, 1)).toEqual(list[0]);
    expect(stepDifference(r, list, undefined, -1)).toEqual(list[2]);
    expect(stepDifference(r, list, list[0], 1)).toEqual(list[1]);
    expect(stepDifference(r, list, list[2], 1)).toEqual(list[2]);
    expect(stepDifference(r, list, { side: 'a', index: 2 }, 1)).toEqual(list[1]);
    expect(stepDifference(r, list, { side: 'a', index: 2 }, -1)).toEqual(list[0]);
    // A paired B node counts as its A partner.
    expect(differencePosition(r, list, { side: 'b', index: 1 })).toBe(0);
  });

  it('validates selections', () => {
    expect(isValidSelection(a, b, { side: 'a', index: 3 })).toBe(true);
    expect(isValidSelection(a, b, { side: 'b', index: 4 })).toBe(false);
    expect(isValidSelection(a, b, { side: 'a', index: -1 })).toBe(false);
  });

  it('keeps "changed" only for nodes changed in the chosen feature', () => {
    expect(Array.from(sideClasses(r, 'a', 'any'))).toEqual([0, 1, 0, 2]);
    expect(Array.from(sideClasses(r, 'b', 'feature:hsv'))).toEqual([0, 1, 0, 3]);
    expect(Array.from(sideClasses(r, 'a', 'position'))).toEqual([0, 0, 0, 2]);
    expect(classCounts(sideClasses(r, 'a', 'any'), sideClasses(r, 'b', 'any'))).toEqual({
      0: 2,
      1: 1,
      2: 1,
      3: 1,
    });
  });
});

describe('channels with different names and features', () => {
  const withFeatures = (
    name: string,
    features: Record<string, [number, number]>,
    F: number,
  ): ChannelGraph => ({
    channel: name,
    kind: name.startsWith('learning_module_') ? 'lm' : 'sm',
    n: P.length,
    pos: Float64Array.from(P.flat()),
    x: new Float64Array(P.length * F),
    F,
    features,
    nonFiniteRows: 0,
  });
  const a = withFeatures('patch_0', { hsv: [0, 3], rgba: [3, 7], curv: [7, 9] }, 9);
  const b = withFeatures('learning_module_0', { curv: [0, 3], hsv: [3, 6], object_id: [6, 7] }, 7);

  it('lists what each channel has', () => {
    expect(featureStructure(a, b)).toEqual([
      { name: 'hsv', widthA: 3, widthB: 3, status: 'both' },
      { name: 'rgba', widthA: 4, status: 'only-a' },
      { name: 'curv', widthA: 2, widthB: 3, status: 'width' },
      { name: 'object_id', widthB: 1, status: 'only-b' },
    ]);
  });

  it('compares position and the shared features only', () => {
    const r = diffChannels(a, file(), b, file(), DEFAULT_DIFF_SETTINGS);
    expect(r.counts).toEqual({ equal: 4, changed: 0, onlyA: 0, onlyB: 0, nA: 4, nB: 4 });
    expect(r.properties.map((p) => [p.key, p.compared])).toEqual([
      ['position', true],
      ['feature:hsv', true],
      ['feature:rgba', false],
      ['feature:curv', false],
      ['feature:object_id', false],
    ]);
    expect([...r.changedMask.keys()]).toEqual(['position', 'feature:hsv']);
  });

  it('measures the radius and the centroid on the channel itself', () => {
    // B is A shifted: aligned on the channel centroids every node pairs up.
    const shifted = { ...a, pos: a.pos.map((v) => v + 10) };
    const aligned = { ...DEFAULT_DIFF_SETTINGS, alignCentroids: true };
    const r = diffChannels(a, file(), shifted, file(), aligned);
    // Off by default: the shifted copy pairs with nothing.
    expect(diffChannels(a, file(), shifted, file(), DEFAULT_DIFF_SETTINGS).counts.equal).toBe(0);
    expect(r.counts.equal).toBe(4);
    expect(r.radius).toBeCloseTo(Math.hypot(0.75, 0.25, 0.25));
  });
});
