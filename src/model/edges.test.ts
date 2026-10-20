import { describe, expect, it } from 'vitest';
import { buildEdgeSegments, edgeNodeCount, graphHasEdgeChannel, isEdgeChannel } from './edges';
import type { ChannelGraph, ObjectGraph } from './types';

// Feature layout of a real 2D-sensor channel (pretrained_models/2d_sensor/learning_2d):
// pose_vectors [0,9], pose_fully_defined [9,10], ..., edge_strength [23,24], coherence [24,25].
const F = 25;
const FEATURES_2D: Record<string, [number, number]> = {
  pose_vectors: [0, 9],
  pose_fully_defined: [9, 10],
  on_object: [10, 11],
  hsv: [18, 21],
  edge_strength: [23, 24],
  coherence: [24, 25],
};

interface NodeSpec {
  pos: [number, number, number];
  tangent?: [number, number, number]; // row 1 of pose_vectors; undefined → curvature pose, no edge
  normal?: [number, number, number];
}

function channel2d(
  nodes: NodeSpec[],
  features = FEATURES_2D,
  kind: 'sm' | 'lm' = 'sm',
): ChannelGraph {
  const n = nodes.length;
  const pos = new Float64Array(n * 3);
  const x = new Float64Array(n * F);
  nodes.forEach((nd, i) => {
    pos.set(nd.pos, 3 * i);
    const row = i * F;
    const nrm = nd.normal ?? [0, 0, 1];
    x.set(nrm, row);
    if (nd.tangent) {
      const [tx, ty, tz] = nd.tangent;
      x.set([tx, ty, tz], row + 3);
      x.set([-ty, tx, 0], row + 6);
      x[row + 9] = 1;
      x[row + 23] = 0.3;
      x[row + 24] = 0.8;
    } else {
      x.set([1, 0, 0], row + 3);
      x.set([0, 1, 0], row + 6);
      x[row + 9] = 0;
    }
  });
  return { channel: 'patch_0', kind, n, pos, x, F, features, nonFiniteRows: 0 };
}

const graph = (channels: ChannelGraph[]): ObjectGraph => ({
  lmId: 0,
  graphId: '021_logo_tbp',
  channels,
  centroid: [0, 0, 0],
});

describe('isEdgeChannel', () => {
  it('needs an SM channel with pose_vectors, pose_fully_defined and an edge-detector output', () => {
    expect(isEdgeChannel(channel2d([]))).toBe(true);
    const onlyStrength = { ...FEATURES_2D };
    delete onlyStrength.coherence;
    expect(isEdgeChannel(channel2d([], onlyStrength))).toBe(true);
    const onlyCoherence = { ...FEATURES_2D };
    delete onlyCoherence.edge_strength;
    expect(isEdgeChannel(channel2d([], onlyCoherence))).toBe(true);
  });

  it('rejects 3D sensor channels and LM channels', () => {
    const threeD: Record<string, [number, number]> = {
      pose_vectors: [0, 9],
      pose_fully_defined: [9, 10],
      hsv: [14, 17],
      principal_curvatures_log: [17, 19],
    };
    expect(isEdgeChannel(channel2d([], threeD))).toBe(false);
    expect(isEdgeChannel(channel2d([], FEATURES_2D, 'lm'))).toBe(false);
    const noFlag = { ...FEATURES_2D };
    delete noFlag.pose_fully_defined;
    expect(isEdgeChannel(channel2d([], noFlag))).toBe(false);
    const shortPose = { ...FEATURES_2D, pose_vectors: [0, 3] as [number, number] };
    expect(isEdgeChannel(channel2d([], shortPose))).toBe(false);
  });

  it('graphHasEdgeChannel is true when any channel qualifies', () => {
    expect(graphHasEdgeChannel(undefined)).toBe(false);
    expect(graphHasEdgeChannel(graph([channel2d([], FEATURES_2D, 'lm')]))).toBe(false);
    expect(graphHasEdgeChannel(graph([channel2d([], FEATURES_2D, 'lm'), channel2d([])]))).toBe(
      true,
    );
  });
});

describe('buildEdgeSegments', () => {
  it('draws p ± t̂·halfLen along row 1 of pose_vectors for edge nodes only', () => {
    const c = channel2d([
      { pos: [1, 2, 0], tangent: [0, 1, 0] },
      { pos: [5, 5, 0] }, // no edge: stays a point
      { pos: [0, 0, 0], tangent: [3, 4, 0] }, // non-unit (voxel-averaged) tangent → normalized
    ]);
    const seg = buildEdgeSegments(c, 0.5);
    expect(seg.count).toBe(2);
    expect(Array.from(seg.nodeIndex)).toEqual([0, 2]);
    expect(Array.from(seg.hidden)).toEqual([1, 0, 1]);
    expect(Array.from(seg.positions.subarray(0, 6))).toEqual([1, 1.5, 0, 1, 2.5, 0]);
    const s2 = Array.from(seg.positions.subarray(6, 12));
    const want = [-0.3, -0.4, 0, 0.3, 0.4, 0];
    s2.forEach((v, k) => expect(Math.abs(v - want[k])).toBeLessThan(1e-6));
  });

  it('keeps a tilted tangent as stored instead of projecting it', () => {
    const c = channel2d([{ pos: [0, 0, 0], tangent: [1, 0, 0.001] }]);
    const seg = buildEdgeSegments(c, 1);
    expect(seg.count).toBe(1);
    expect(seg.positions[5]).toBeCloseTo(0.001, 6);
  });

  it('skips non-finite rows, zero tangents and nodes flagged 0', () => {
    const c = channel2d([
      { pos: [NaN, 0, 0], tangent: [1, 0, 0] },
      { pos: [0, 0, 0], tangent: [0, 0, 0] },
      { pos: [0, 0, 0], tangent: [NaN, 1, 0] },
      { pos: [0, 0, 0], tangent: [1, 0, 0] },
    ]);
    const seg = buildEdgeSegments(c, 1);
    expect(seg.count).toBe(1);
    expect(Array.from(seg.nodeIndex)).toEqual([3]);
    expect(Array.from(seg.hidden)).toEqual([0, 0, 0, 1]);
    expect(edgeNodeCount(c)).toBe(1);
  });

  it('returns no segments for a non-edge channel or a non-positive length', () => {
    const c = channel2d([{ pos: [0, 0, 0], tangent: [1, 0, 0] }]);
    expect(buildEdgeSegments(c, 0).count).toBe(0);
    expect(buildEdgeSegments(c, NaN).count).toBe(0);
    expect(
      buildEdgeSegments(channel2d([{ pos: [0, 0, 0], tangent: [1, 0, 0] }], FEATURES_2D, 'lm'), 1)
        .count,
    ).toBe(0);
  });
});
