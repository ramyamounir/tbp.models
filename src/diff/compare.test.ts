import { describe, expect, it } from 'vitest';
import type { ChannelGraph, ModelFile } from '../model/types';
import { diffChannels, vectorAngleDeg } from './compare';
import { applyPreset, patchDiffSettings, PRESETS, type DiffSettings } from './settings';

/** A channel with a 9-wide pose_vectors feature (three 3-vectors per row). */
function channel(pos: number[][], pose: number[][]): ChannelGraph {
  return {
    channel: 'patch',
    kind: 'sm',
    n: pos.length,
    pos: Float64Array.from(pos.flat()),
    x: Float64Array.from(pose.flat()),
    F: 9,
    features: { pose_vectors: [0, 9] },
    nonFiniteRows: 0,
  };
}

const file: ModelFile = {
  fileName: 'm.pt',
  byteLength: 0,
  lms: [],
  lmToLm: [],
  smToLm: [],
  objectIdIndex: new Map(),
};

const POS = [
  [0.1, 0.2, 0.3],
  [0.4, 0.5, 0.6],
  [0.7, 0.8, 0.9],
];
// Not axis-aligned, so the acos of the normalized dot product of a vector with itself is not 1.
const POSE = [0.267, 0.535, 0.802, -0.873, 0.218, 0.436, 0.408, 0.816, -0.408];
const poseRows = () => POS.map(() => [...POSE]);

/** POS with row 1 moved by one ulp in x. */
function ulpMoved(): number[][] {
  const p = POS.map((r) => [...r]);
  p[1][0] = p[1][0] + Number.EPSILON * p[1][0];
  return p;
}

const changedOf = (s: DiffSettings, a: ChannelGraph, b: ChannelGraph) =>
  diffChannels(a, file, b, file, s).counts.changed;

const ZERO_NEAREST = patchDiffSettings(PRESETS.default, {
  positionPct: 0,
  defaultFeatureTol: 0,
  hsv: { enabled: true, tol: 0 },
  poseVectorsDeg: { enabled: true, tol: 0 },
});

describe('vectorAngleDeg', () => {
  it('is exactly 0 for identical and parallel vectors', () => {
    const [x, y, z] = POSE;
    expect(vectorAngleDeg(x, y, z, x, y, z)).toBe(0);
    expect(vectorAngleDeg(x, y, z, 2 * x, 2 * y, 2 * z)).toBe(0);
  });

  it('handles zero and opposite vectors', () => {
    expect(vectorAngleDeg(0, 0, 0, 0, 0, 0)).toBe(0);
    expect(vectorAngleDeg(0, 0, 0, 1, 0, 0)).toBe(180);
    expect(vectorAngleDeg(1, 0, 0, -1, 0, 0)).toBeCloseTo(180, 12);
    expect(vectorAngleDeg(1, 0, 0, 0, 1, 0)).toBeCloseTo(90, 12);
  });

  it('measures tiny angles accurately', () => {
    const t = 1e-10; // radians
    expect(vectorAngleDeg(1, 0, 0, Math.cos(t), Math.sin(t), 0)).toBeCloseTo(
      (t * 180) / Math.PI,
      20,
    );
  });
});

describe('zero tolerances', () => {
  it('do not flag identical pose vectors', () => {
    const a = channel(POS, poseRows());
    const b = channel(POS, poseRows());
    expect(changedOf(ZERO_NEAREST, a, b)).toBe(0);
    expect(changedOf(PRESETS.exact, a, b)).toBe(0);
  });

  it('flag a one-ulp position offset of a nearest pair at a 0 % position tolerance', () => {
    const a = channel(POS, poseRows());
    const b = channel(ulpMoved(), poseRows());
    expect(changedOf(PRESETS.default, a, b)).toBe(0);
    const r = diffChannels(a, file, b, file, ZERO_NEAREST);
    expect(r.counts).toMatchObject({ equal: 2, changed: 1, onlyA: 0, onlyB: 0 });
    expect(r.changedMask.get('position')![1]).toBe(1);
  });

  it('pair only coincident nodes at a 0 % pairing distance', () => {
    const a = channel(POS, poseRows());
    const b = channel(ulpMoved(), poseRows());
    const r = diffChannels(a, file, b, file, { ...ZERO_NEAREST, pairingPct: 0 });
    expect(r.counts).toMatchObject({ equal: 2, changed: 0, onlyA: 1, onlyB: 1 });
    expect(r.tolM).toBe(0);
  });

  it('flag a pair beyond the position tolerance but within the pairing distance', () => {
    const moved = POS.map((r) => [...r]);
    moved[1][0] += 0.01;
    const s = { ...PRESETS.default, pairingPct: 10, positionPct: 0.5 };
    const r = diffChannels(channel(POS, poseRows()), file, channel(moved, poseRows()), file, s);
    expect(r.counts).toMatchObject({ changed: 1, onlyA: 0, onlyB: 0 });
    expect(r.histogram.tol).toBe(10);
  });

  it('flag a one-ulp position offset in index mode at 0 %', () => {
    const a = channel(POS, poseRows());
    const b = channel(ulpMoved(), poseRows());
    const r = diffChannels(a, file, b, file, { ...ZERO_NEAREST, match: 'index' });
    expect(r.counts.changed).toBe(1);
    expect(r.properties.find((p) => p.key === 'position')!.max).toBeGreaterThan(0);
  });

  it('flag a one-ulp feature change with the exact preset', () => {
    const pose = poseRows();
    pose[2][4] += Number.EPSILON;
    expect(changedOf(PRESETS.exact, channel(POS, poseRows()), channel(POS, pose))).toBe(1);
  });

  it('pair coincident nodes when every node sits at one point', () => {
    const one = [
      [0.5, 0.5, 0.5],
      [0.5, 0.5, 0.5],
    ];
    const pose = one.map(() => [...POSE]);
    const r = diffChannels(channel(one, pose), file, channel(one, pose), file, PRESETS.exact);
    expect(r.counts).toMatchObject({ equal: 2, changed: 0, onlyA: 0, onlyB: 0 });
  });
});

describe('exact preset', () => {
  it('sets every tolerance to 0 and keeps the matching mode', () => {
    for (const match of ['nearest', 'index'] as const) {
      const s = applyPreset({ ...PRESETS.default, match, alignCentroids: true }, 'exact');
      expect(s).toMatchObject({
        preset: 'exact',
        match,
        alignCentroids: true,
        positionPct: 0,
        defaultFeatureTol: 0,
        poseVectorsDeg: { enabled: true, tol: 0 },
        hsv: { enabled: true, tol: 0 },
      });
    }
  });

  it('flags a one-ulp move as a changed pair with either matching mode', () => {
    const a = channel(POS, poseRows());
    const b = channel(ulpMoved(), poseRows());
    const nearest = diffChannels(a, file, b, file, PRESETS.exact).counts;
    const index = diffChannels(a, file, b, file, { ...PRESETS.exact, match: 'index' }).counts;
    expect(nearest).toMatchObject({ changed: 1, onlyA: 0, onlyB: 0 });
    expect(index).toMatchObject({ changed: 1, onlyA: 0, onlyB: 0 });
  });

  it('keeps the pairing distance', () => {
    expect(applyPreset({ ...PRESETS.default, pairingPct: 7 }, 'exact').pairingPct).toBe(7);
  });

  it('is not turned custom by node matching changes', () => {
    const s = applyPreset(PRESETS.default, 'exact');
    for (const patch of [
      { pairingPct: 0 },
      { match: 'index' as const },
      { alignCentroids: true },
    ]) {
      const next = patchDiffSettings(s, patch);
      expect(next).not.toBe(s);
      expect(next.preset).toBe('exact');
    }
    expect(patchDiffSettings(s, { pairingPct: 0, positionPct: 1 }).preset).toBe('custom');
  });

  it('is kept by patchDiffSettings when named', () => {
    const s = patchDiffSettings(PRESETS.default, { ...PRESETS.exact, preset: 'exact' });
    expect(s.preset).toBe('exact');
    expect(patchDiffSettings(s, { positionPct: 1 }).preset).toBe('custom');
  });
});
