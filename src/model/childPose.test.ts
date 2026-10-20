import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { childPlacement, childRotation, type Vec3 } from './childPose';

// Non-identity, non-symmetric M: 30° about normalized (1, 2, 3). Rows = child axes in parent frame.
const axis = new THREE.Vector3(1, 2, 3).normalize();
const rot = new THREE.Matrix4().makeRotationAxis(axis, THREE.MathUtils.degToRad(30));
const e = rot.elements; // column-major
// M = rot (row-major flatten): M[i][j] = e[j*4 + i]
const row9 = [e[0], e[4], e[8], e[1], e[5], e[9], e[2], e[6], e[10]];
const M = [
  [row9[0], row9[1], row9[2]],
  [row9[3], row9[4], row9[5]],
  [row9[6], row9[7], row9[8]],
];
/** Mᵀ·v computed by hand (independent of three.js). */
const mT = (v: Vec3): Vec3 => [
  M[0][0] * v[0] + M[1][0] * v[1] + M[2][0] * v[2],
  M[0][1] * v[0] + M[1][1] * v[1] + M[2][1] * v[2],
  M[0][2] * v[0] + M[1][2] * v[1] + M[2][2] * v[2],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const parentCentroid: Vec3 = [0.02, 1.5, -0.03];
const nodePos: Vec3 = [0.031, 1.47, 0.012];
const childCentroid: Vec3 = [0.004, 1.52, 0.006];
const loc: Vec3 = [0.01, 1.49, -0.02];
const childPts: Vec3[] = [
  [0.05, 1.5, 0.0],
  [0.0, 1.56, 0.01],
  [-0.02, 1.48, 0.07],
];

function expectClose(a: ArrayLike<number>, b: ArrayLike<number>, tol = 1e-9) {
  for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(tol);
}

describe('childRotation', () => {
  it('applies Mᵀ (rows of M are child axes in the parent frame)', () => {
    const R = childRotation(row9);
    for (const c of childPts) {
      const p = new THREE.Vector3(...c).applyMatrix4(R);
      expectClose(p.toArray(), mT(c));
    }
    // unit x of the child maps to row 0 of M
    expectClose(new THREE.Vector3(1, 0, 0).applyMatrix4(R).toArray(), M[0]);
  });
});

describe('childPlacement', () => {
  it('maps c to nodePos + Mᵀ·(c − l) with location_rel_model', () => {
    const { matrix, approximate } = childPlacement(nodePos, row9, loc, childCentroid);
    expect(approximate).toBe(false);
    for (const c of childPts) {
      const p = new THREE.Vector3(...c).applyMatrix4(matrix);
      expectClose(p.toArray(), add(nodePos, mT(sub(c, loc))));
    }
    expectClose(new THREE.Vector3(...loc).applyMatrix4(matrix).toArray(), nodePos);
  });

  it('maps c to nodePos + Mᵀ·(c − childCentroid) without location_rel_model', () => {
    const { matrix, approximate } = childPlacement(nodePos, row9, undefined, childCentroid);
    expect(approximate).toBe(true);
    for (const c of childPts) {
      const p = new THREE.Vector3(...c).applyMatrix4(matrix);
      expectClose(p.toArray(), add(nodePos, mT(sub(c, childCentroid))));
    }
  });

  it('overlay offset from the node is identical with centering on and off', () => {
    const { matrix } = childPlacement(nodePos, row9, loc, childCentroid);
    const offsets = [true, false].map((center) => {
      const objectGroup = new THREE.Group();
      objectGroup.rotation.set(0.4, -1.1, 0.7, 'XYZ');
      const modelFrameGroup = new THREE.Group();
      modelFrameGroup.position.set(
        ...(center ? (parentCentroid.map((v) => -v) as Vec3) : ([0, 0, 0] as Vec3)),
      );
      objectGroup.add(modelFrameGroup);
      const node = new THREE.Object3D();
      node.position.set(...nodePos);
      modelFrameGroup.add(node);
      const childGroup = new THREE.Group();
      childGroup.matrixAutoUpdate = false;
      childGroup.matrix.copy(matrix);
      modelFrameGroup.add(childGroup);
      const childPoint = new THREE.Object3D();
      childPoint.position.set(...childPts[1]);
      childGroup.add(childPoint);
      objectGroup.updateMatrixWorld(true);
      const pw = childPoint.getWorldPosition(new THREE.Vector3());
      const nw = node.getWorldPosition(new THREE.Vector3());
      return pw.sub(nw).toArray();
    });
    expectClose(offsets[0], offsets[1]);
    // and the offset is the rotated Mᵀ·(c − l)
    const objRot = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(0.4, -1.1, 0.7, 'XYZ'),
    );
    expectClose(
      offsets[0],
      new THREE.Vector3(...mT(sub(childPts[1], loc))).applyMatrix4(objRot).toArray(),
    );
  });
});
