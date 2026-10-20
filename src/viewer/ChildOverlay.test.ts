import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { childPlacement, childRotation, type Vec3 } from '../model/childPose';
import type { ChannelGraph, ObjectGraph } from '../model/types';
import {
  buildChildCloud,
  centerChildCloud,
  childCloudPositions,
  lmNodePose,
  placeChildCloud,
} from './ChildOverlay';

// Known asymmetric rotation R: 30° about normalized (1, 2, 3). R is the child→parent rotation.
const axis = new THREE.Vector3(1, 2, 3).normalize();
const Rm = new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(30));
const e = Rm.elements; // column-major: R[i][j] = e[j*4 + i]
const R = [
  [e[0], e[4], e[8]],
  [e[1], e[5], e[9]],
  [e[2], e[6], e[10]],
];
// Monty stores pose.as_matrix().T of R: row9 = Rᵀ flattened row-major, i.e. row9[3i+j] = R[j][i].
const row9 = [R[0][0], R[1][0], R[2][0], R[0][1], R[1][1], R[2][1], R[0][2], R[1][2], R[2][2]];
const applyR = (v: Vec3): Vec3 => [
  R[0][0] * v[0] + R[0][1] * v[1] + R[0][2] * v[2],
  R[1][0] * v[0] + R[1][1] * v[1] + R[1][2] * v[2],
  R[2][0] * v[0] + R[2][1] * v[1] + R[2][2] * v[2],
];

function expectClose(a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-9) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i] - b[i])).toBeLessThanOrEqual(tol);
}

function channel(
  name: string,
  kind: 'sm' | 'lm',
  pts: number[][],
  extra?: Partial<ChannelGraph>,
): ChannelGraph {
  return {
    channel: name,
    kind,
    n: pts.length,
    pos: Float64Array.from(pts.flat()),
    x: new Float64Array(pts.length),
    F: 1,
    features: { on_object: [0, 1] },
    nonFiniteRows: pts.filter((p) => !p.every(Number.isFinite)).length,
    ...extra,
  };
}

function graph(channels: ChannelGraph[], centroid: Vec3 = [0, 0, 0]): ObjectGraph {
  return { lmId: 0, graphId: 'child', channels, centroid };
}

describe('childRotation (Monty storage convention)', () => {
  it('applies the stored child→parent rotation R to non-collinear points', () => {
    expect(Math.abs(R[0][1] - R[1][0])).toBeGreaterThan(1e-3); // R is not symmetric
    const M = childRotation(row9);
    const pts: Vec3[] = [
      [1, 0, 0],
      [0.2, -0.7, 0.4],
      [-0.3, 0.5, 1.1],
    ];
    for (const p of pts) {
      const v = new THREE.Vector3(...p).applyMatrix4(M);
      expectClose([v.x, v.y, v.z], applyR(p));
    }
  });
});

describe('placeChildCloud', () => {
  const nodePos: Vec3 = [0.031, 1.47, 0.012];
  const childCentroid: Vec3 = [0.004, 1.52, 0.006];
  const loc: Vec3 = [0.01, 1.49, -0.02];

  it('sets points.matrix = childPlacement(...).matrix with matrixAutoUpdate false (with l)', () => {
    const pts = new THREE.Points();
    const approx = placeChildCloud(
      pts,
      { pos: nodePos, row9, locationRelModel: loc },
      childCentroid,
    );
    const ref = childPlacement(nodePos, row9, loc, childCentroid);
    expect(pts.matrixAutoUpdate).toBe(false);
    expectClose(pts.matrix.elements, ref.matrix.elements, 0);
    expect(approx).toBe(false);
    // c = l lands on the node.
    const p = new THREE.Vector3(...loc).applyMatrix4(pts.matrix);
    expectClose([p.x, p.y, p.z], nodePos);
  });

  it('falls back to the child centroid and reports approximate placement', () => {
    const pts = new THREE.Points();
    const approx = placeChildCloud(pts, { pos: nodePos, row9 }, childCentroid);
    const ref = childPlacement(nodePos, row9, undefined, childCentroid);
    expect(pts.matrixAutoUpdate).toBe(false);
    expectClose(pts.matrix.elements, ref.matrix.elements, 0);
    expect(approx).toBe(true);
  });

  it('centerChildCloud uses the same rotation, centered on the child centroid', () => {
    const pts = new THREE.Points();
    centerChildCloud(pts, row9, childCentroid, 2);
    const c = new THREE.Vector3(...childCentroid).applyMatrix4(pts.matrix);
    expectClose([c.x, c.y, c.z], [0, 0, 0]);
    const q: Vec3 = [childCentroid[0] + 0.01, childCentroid[1], childCentroid[2] - 0.02];
    const v = new THREE.Vector3(...q).applyMatrix4(pts.matrix);
    expectClose([v.x, v.y, v.z], applyR([0.02, 0, -0.04]));
  });
});

describe('buildChildCloud', () => {
  it('uses SM channels only when present, skipping non-finite rows', () => {
    const g = graph([
      channel('patch', 'sm', [
        [0, 0, 0],
        [NaN, 0, 0],
        [1, 1, 1],
      ]),
      channel('learning_module_0', 'lm', [[5, 5, 5]]),
    ]);
    const pos = childCloudPositions(g)!;
    expect(Array.from(pos)).toEqual([0, 0, 0, 1, 1, 1]);
    const pts = buildChildCloud(g)!;
    expect(pts).toBeInstanceOf(THREE.Points);
    expect(pts.geometry.getAttribute('position').count).toBe(2);
    expect(pts.matrixAutoUpdate).toBe(false);
  });

  it('falls back to all channels when the child has no SM channel', () => {
    const g = graph([channel('learning_module_0', 'lm', [[5, 5, 5]])]);
    expect(Array.from(childCloudPositions(g)!)).toEqual([5, 5, 5]);
  });

  it('downsamples by stride to at most maxPoints', () => {
    const pts = Array.from({ length: 4999 }, (_, i) => [i, 0, 0]);
    const g = graph([
      channel('patch', 'sm', pts.slice(0, 2500)),
      channel('patch_1', 'sm', pts.slice(2500)),
    ]);
    const pos = childCloudPositions(g, 2000)!;
    expect(pos.length / 3).toBeLessThanOrEqual(2000);
    // stride = ceil(4999 / 2000) = 3 → rows 0, 3, 6, … across the concatenated channels
    expect(pos[0]).toBe(0);
    expect(pos[3]).toBe(3);
    expect(pos.length / 3).toBe(Math.ceil(4999 / 3));
  });

  it('returns null when there are no finite points', () => {
    const g = graph([channel('patch', 'sm', [[NaN, 0, 0]])]);
    expect(buildChildCloud(g)).toBeNull();
    expect(buildChildCloud(graph([]))).toBeNull();
  });
});

describe('lmNodePose', () => {
  it('reads pos, pose_vectors and location_rel_model', () => {
    const c: ChannelGraph = {
      channel: 'learning_module_0',
      kind: 'lm',
      n: 1,
      pos: Float64Array.from([0.1, 0.2, 0.3]),
      x: Float64Array.from([...row9, 1, 1, 42, 0.01, 0.02, 0.03]),
      F: 15,
      features: {
        pose_vectors: [0, 9],
        pose_fully_defined: [9, 10],
        on_object: [10, 11],
        object_id: [11, 12],
        location_rel_model: [12, 15],
      },
      nonFiniteRows: 0,
    };
    const p = lmNodePose(c, 0)!;
    expect(p.pos).toEqual([0.1, 0.2, 0.3]);
    expectClose(p.row9, row9, 0);
    expect(p.locationRelModel).toEqual([0.01, 0.02, 0.03]);
    expect(lmNodePose(c, 1)).toBeUndefined();
  });
});
