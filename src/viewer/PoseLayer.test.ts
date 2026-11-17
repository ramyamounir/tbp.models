import { describe, expect, it } from 'vitest';
import type { ChannelGraph } from '../model/types';
import { hasPoseVectors, poseSegments } from './PoseLayer';

/** Two nodes at (0,0,0) and (1,0,0); pose rows are 2·x, 3·y, 4·z; node 1 is not fully defined. */
function channel(kind: 'sm' | 'lm'): ChannelGraph {
  const row = [2, 0, 0, 0, 3, 0, 0, 0, 4];
  return {
    channel: kind === 'sm' ? 'patch' : 'learning_module_0',
    kind,
    n: 2,
    pos: Float64Array.from([0, 0, 0, 1, 0, 0]),
    x: Float64Array.from([...row, 1, ...row, 0]),
    F: 10,
    features: { pose_vectors: [0, 9], pose_fully_defined: [9, 10] },
    nonFiniteRows: 0,
  };
}

describe('poseSegments', () => {
  it('draws the SM normal from the node, normalized to the length', () => {
    const { positions, nodeIndex } = poseSegments(channel('sm'), 0, 0.5);
    expect([...nodeIndex]).toEqual([0, 1]);
    expect([...positions]).toEqual([0, 0, 0, 0.5, 0, 0, 1, 0, 0, 1.5, 0, 0]);
  });

  it('centres SM curvature directions; `definedOnly` skips nodes that are not fully defined', () => {
    expect([...poseSegments(channel('sm'), 1, 0.5).nodeIndex]).toEqual([0, 1]);
    expect([...poseSegments(channel('sm'), 0, 0.5, true).nodeIndex]).toEqual([0, 1]);
    const { positions, nodeIndex } = poseSegments(channel('sm'), 1, 0.5, true);
    expect([...nodeIndex]).toEqual([0]);
    expect([...positions]).toEqual([0, -0.25, 0, 0, 0.25, 0]);
  });

  it('draws every LM axis from the node, whatever pose_fully_defined says', () => {
    const { positions, nodeIndex } = poseSegments(channel('lm'), 2, 1, true);
    expect([...nodeIndex]).toEqual([0, 1]);
    expect([...positions]).toEqual([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1]);
  });

  it('needs a 9-wide pose_vectors', () => {
    expect(hasPoseVectors(channel('sm'))).toBe(true);
    expect(hasPoseVectors({ ...channel('sm'), features: { pose_vectors: [0, 3] } })).toBe(false);
    expect(hasPoseVectors({ ...channel('sm'), features: {} })).toBe(false);
  });
});
