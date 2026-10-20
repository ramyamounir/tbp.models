/**
 * Child-object pose from an LM node (spec Phase 3 "Child pose (shared)"). Pure math: three.js
 * `Matrix4` / `Vector3` only, no scene access.
 *
 * `row9` = the LM node's `pose_vectors` (`x[i, pv0 : pv0 + 9]`), a row-major 3×3 `M` whose rows
 * are the child x/y/z axes expressed in the parent frame. A child-frame point `c` maps to the
 * parent frame as `Mᵀ·c`. The convention is fixed by derivation from tbp.monty (the MLH rotation
 * maps parent→child, `get_output` passes its inverse and `_object_pose_to_features` stores
 * `as_matrix().T`), so there is no convention switch.
 *
 * All inputs are raw, uncentered model coordinates.
 */
import * as THREE from 'three';

export type Vec3 = [number, number, number];

/** Rotation-only matrix `Mᵀ` (column j of the 3×3 = row j of `M`). */
export function childRotation(row9: ArrayLike<number>): THREE.Matrix4 {
  const r = row9;
  const m = new THREE.Matrix4();
  // prettier-ignore
  m.set(
    r[0], r[3], r[6], 0,
    r[1], r[4], r[7], 0,
    r[2], r[5], r[8], 0,
    0,    0,    0,    1,
  );
  return m;
}

/**
 * Placement of the child graph's raw points in the parent's raw model frame:
 * `p = Mᵀ·c + t`, `t = nodePos − Mᵀ·anchor`, where `anchor = locationRelModel` when the LM maps
 * `location_rel_model` (exact) and the child centroid otherwise (`approximate: true`).
 */
export function childPlacement(
  nodePos: Vec3,
  row9: ArrayLike<number>,
  locationRelModel: Vec3 | undefined,
  childCentroid: Vec3,
): { matrix: THREE.Matrix4; approximate: boolean } {
  const R = childRotation(row9);
  const anchor = new THREE.Vector3(...(locationRelModel ?? childCentroid)).applyMatrix4(R);
  const t = new THREE.Vector3(...nodePos).sub(anchor);
  return { matrix: R.clone().setPosition(t), approximate: locationRelModel === undefined };
}
