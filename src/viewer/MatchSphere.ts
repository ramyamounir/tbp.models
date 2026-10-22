/**
 * Translucent sphere around the selected node showing the inspector's match radius: nodes of
 * other channels inside it count as being at the selected location. Brighter at the silhouette
 * (rim) so its extent reads at any size, `--select` colored, no depth writes. Lives in
 * `viewer.overlayGroup` at the node's raw position; its radius is in raw model units.
 */
import * as THREE from 'three';
import type { Vec3 } from '../model/childPose';
import { readToken } from '../theme/readToken';
import { cssToRgb } from './colors';
import { disposeObject } from './Glyphs';

const vertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(normalMatrix * normal);
    // Ortho cameras look straight down -z; perspective ones toward the vertex.
    vView = projectionMatrix[3][3] < 0.5 ? normalize(-mv.xyz) : vec3(0.0, 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 color;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
    gl_FragColor = vec4(color, 0.06 + 0.5 * pow(rim, 3.0));
  }
`;

export class MatchSphere {
  private readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;

  constructor(parent: THREE.Object3D, pos: Vec3) {
    const material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { color: { value: new THREE.Vector3(...cssToRgb(readToken('--select'))) } },
      transparent: true,
      depthWrite: false,
      side: THREE.FrontSide,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), material);
    this.mesh.name = 'match-sphere';
    this.mesh.renderOrder = 9; // after the points, before the glyphs
    this.mesh.raycast = () => {}; // never pickable
    this.mesh.position.set(pos[0], pos[1], pos[2]);
    this.setRadius(0);
    parent.add(this.mesh);
  }

  /** Radius in raw model units; hidden at 0 (exact matches only). */
  setRadius(r: number): void {
    const ok = Number.isFinite(r) && r > 0;
    this.mesh.visible = ok;
    if (ok) this.mesh.scale.setScalar(r);
  }

  /** Re-read `--select` (call one frame after a `resolvedTheme` change). */
  recolor(): void {
    this.mesh.material.uniforms.color.value.set(...cssToRgb(readToken('--select')));
  }

  dispose(): void {
    disposeObject(this.mesh);
  }
}
