/**
 * One `THREE.Points` per input channel (spec Phase 3 "PointCloudLayer"). Positions are copied raw
 * (uncentered) from `ChannelGraph.pos`; centering is done only by `modelFrameGroup.position`.
 * Rows with a non-finite coordinate are written as the graph centroid with alpha 0 and are never
 * pickable, so NaN never reaches the GPU buffer or the bounding sphere.
 */
import * as THREE from 'three';
import type { ChannelGraph, ObjectGraph } from '../model/types';

export const DIM_ALPHA = 0.25;
export const DIM_SIZE = 0.7;

const vertexShader = /* glsl */ `
  attribute vec3 color;
  attribute float alpha;
  attribute float sizeScale;
  uniform float size;
  uniform float pixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = alpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = alpha <= 0.0 ? 0.0 : size * sizeScale * pixelRatio;
  }
`;

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha <= 0.0) discard;
    vec2 d = gl_PointCoord - vec2(0.5);
    float r = length(d);
    if (r > 0.5) discard;
    float edge = 1.0 - smoothstep(0.42, 0.5, r);
    gl_FragColor = vec4(vColor, vAlpha * edge);
  }
`;

/** Object bounding-sphere radius `R` (centroid-centered, raw coords); 0.01 when degenerate. */
export function graphRadius(graph: ObjectGraph): number {
  const [cx, cy, cz] = graph.centroid;
  let r2 = 0;
  for (const c of graph.channels) {
    const p = c.pos;
    for (let i = 0; i < c.n; i++) {
      const x = p[3 * i];
      const y = p[3 * i + 1];
      const z = p[3 * i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2 + (z - cz) ** 2;
      if (d > r2) r2 = d;
    }
  }
  const R = Math.sqrt(r2);
  return Number.isFinite(R) && R >= 1e-6 ? R : 0.01;
}

export class PointCloudLayer {
  readonly points: THREE.Points;
  readonly channel: ChannelGraph;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly finite: Uint8Array;
  /** Nodes drawn as edge segments instead ("Display as: Edges"); alpha 0 but still pickable. */
  private hidden: Uint8Array | null = null;
  private lastColors: { colors: Float32Array; dimmed: Uint8Array; whole: boolean } | null = null;

  constructor(channel: ChannelGraph, centroid: [number, number, number]) {
    this.channel = channel;
    const n = channel.n;
    const pos = new Float32Array(n * 3);
    this.finite = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const x = channel.pos[3 * i];
      const y = channel.pos[3 * i + 1];
      const z = channel.pos[3 * i + 2];
      const ok = Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
      this.finite[i] = ok ? 1 : 0;
      pos[3 * i] = ok ? x : centroid[0];
      pos[3 * i + 1] = ok ? y : centroid[1];
      pos[3 * i + 2] = ok ? z : centroid[2];
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const alpha = new Float32Array(n);
    for (let i = 0; i < n; i++) alpha[i] = this.finite[i];
    geometry.setAttribute('alpha', new THREE.BufferAttribute(alpha, 1));
    geometry.setAttribute('sizeScale', new THREE.BufferAttribute(new Float32Array(n).fill(1), 1));
    geometry.computeBoundingSphere();
    this.geometry = geometry;
    this.material = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: { size: { value: 3 }, pixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: true,
    });
    this.points = new THREE.Points(geometry, this.material);
    this.points.name = `points:${channel.channel}`;
    this.points.userData.layer = this;
  }

  /**
   * `colors` (n*3 sRGB) and per-node dim flags; dimmed nodes get alpha 0.25 and size × 0.7.
   * `dimWholeChannel` dims alpha/size of every node but keeps the colors (used for "Dim nodes not
   * in selected channel").
   */
  setColors(colors: Float32Array, dimmed: Uint8Array, dimWholeChannel: boolean): void {
    const n = this.channel.n;
    const color = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    const alpha = this.geometry.getAttribute('alpha') as THREE.BufferAttribute;
    const size = this.geometry.getAttribute('sizeScale') as THREE.BufferAttribute;
    (color.array as Float32Array).set(colors.subarray(0, n * 3));
    const a = alpha.array as Float32Array;
    const s = size.array as Float32Array;
    const hidden = this.hidden;
    for (let i = 0; i < n; i++) {
      const dim = dimWholeChannel || dimmed[i] === 1;
      const shown = this.finite[i] === 1 && !(hidden && hidden[i] === 1);
      a[i] = shown ? (dim ? DIM_ALPHA : 1) : 0;
      s[i] = dim ? DIM_SIZE : 1;
    }
    color.needsUpdate = true;
    alpha.needsUpdate = true;
    size.needsUpdate = true;
    this.lastColors = { colors, dimmed, whole: dimWholeChannel };
  }

  /**
   * Hide the points of `mask[i] === 1` (their edge segment stands in for them); `null` shows every
   * finite node again. Hidden nodes stay pickable so clicking an edge's center still selects it.
   */
  setHidden(mask: Uint8Array | null): void {
    this.hidden = mask;
    const last = this.lastColors;
    if (last) this.setColors(last.colors, last.dimmed, last.whole);
  }

  setPointSize(px: number, pixelRatio: number): void {
    this.material.uniforms.size.value = px;
    this.material.uniforms.pixelRatio.value = pixelRatio;
  }

  /** Rows with non-finite positions are never pickable. */
  isPickable(i: number): boolean {
    return i >= 0 && i < this.channel.n && this.finite[i] === 1;
  }

  dispose(): void {
    this.points.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
