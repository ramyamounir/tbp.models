/**
 * Dashed ring marking the inspector's active node when it differs from the selection (spec
 * Phase 4 "Active-node marker"). Same size as the Phase 3 selection ring, `--select` at 0.85
 * opacity, no depth test. Lives in `viewer.overlayGroup` at the node's raw position.
 */
import * as THREE from 'three';
import { readToken } from '../theme/readToken';
import { cssToRgb } from './colors';
import { buildRingMarker, disposeObject } from './Glyphs';
import type { Vec3 } from '../model/childPose';

/** Must match the selection ring size in Scene.ts. */
export const ACTIVE_RING_PX = 24;

export class ActiveNodeMarker {
  private readonly marker: THREE.Points;

  constructor(parent: THREE.Object3D, pos: Vec3, pixelRatio: number) {
    this.marker = buildRingMarker({
      color: cssToRgb(readToken('--select')),
      sizePx: ACTIVE_RING_PX,
      pixelRatio,
      opacity: 0.85,
      dashed: true,
    });
    this.marker.name = 'active-node-marker';
    this.marker.position.set(pos[0], pos[1], pos[2]);
    parent.add(this.marker);
  }

  /** Re-read `--select` (call one frame after a `resolvedTheme` change). */
  recolor(): void {
    const mat = this.marker.material as THREE.ShaderMaterial;
    (mat.uniforms.color.value as THREE.Vector3).set(...cssToRgb(readToken('--select')));
  }

  dispose(): void {
    disposeObject(this.marker);
  }
}
