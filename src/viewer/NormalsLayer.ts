/**
 * Surface normals for every SM node (spec Phase 3 "Surface normals"): one `LineSegments` per SM
 * channel that maps `pose_vectors`, from the raw `pos` to `pos + n̂ · 0.05 R`. Not pickable.
 */
import * as THREE from 'three';
import type { ObjectGraph } from '../model/types';
import { cssToRgb } from './colors';

const OPACITY = 0.8;
const DIMMED_OPACITY = 0.2;

export class NormalsLayer {
  readonly group = new THREE.Group();
  private readonly segments: {
    channel: string;
    lines: THREE.LineSegments;
    positions: Float32Array; // every segment (6 floats each)
    nodeIndex: Int32Array; // node row of each segment
  }[] = [];

  constructor(graph: ObjectGraph, R: number, colorCss: string) {
    this.group.name = 'normals';
    const len = 0.05 * R;
    const [r, g, b] = cssToRgb(colorCss);
    const c = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
    for (const ch of graph.channels) {
      if (ch.kind !== 'sm' || !Object.prototype.hasOwnProperty.call(ch.features, 'pose_vectors'))
        continue;
      const pv0 = ch.features.pose_vectors[0];
      const out = new Float32Array(ch.n * 6);
      const nodeIndex = new Int32Array(ch.n);
      let k = 0;
      for (let i = 0; i < ch.n; i++) {
        const px = ch.pos[3 * i];
        const py = ch.pos[3 * i + 1];
        const pz = ch.pos[3 * i + 2];
        const nx = ch.x[i * ch.F + pv0];
        const ny = ch.x[i * ch.F + pv0 + 1];
        const nz = ch.x[i * ch.F + pv0 + 2];
        if (![px, py, pz, nx, ny, nz].every(Number.isFinite)) continue;
        const nl = Math.hypot(nx, ny, nz);
        if (nl <= 1e-9) continue;
        const s = len / nl;
        out.set([px, py, pz, px + nx * s, py + ny * s, pz + nz * s], k);
        nodeIndex[k / 6] = i;
        k += 6;
      }
      if (k === 0) continue;
      const positions = out.slice(0, k);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
      const material = new THREE.LineBasicMaterial({
        color: c,
        transparent: true,
        opacity: OPACITY,
        depthWrite: false,
      });
      const lines = new THREE.LineSegments(geometry, material);
      lines.raycast = () => {};
      this.segments.push({
        channel: ch.channel,
        lines,
        positions,
        nodeIndex: nodeIndex.slice(0, k / 6),
      });
      this.group.add(lines);
    }
  }

  setColor(colorCss: string): void {
    const [r, g, b] = cssToRgb(colorCss);
    for (const { lines } of this.segments) {
      (lines.material as THREE.LineBasicMaterial).color.setRGB(r, g, b, THREE.SRGBColorSpace);
    }
  }

  /** `selectedChannel` defined → other channels' segments are dimmed. */
  setDimmed(selectedChannel: string | undefined): void {
    for (const { channel, lines } of this.segments) {
      const dim = selectedChannel !== undefined && channel !== selectedChannel;
      (lines.material as THREE.LineBasicMaterial).opacity = dim ? DIMMED_OPACITY : OPACITY;
    }
  }

  /** Leave out the normals of nodes hidden from the legend (`hidden(channel)[i] === 1`). */
  setHidden(hidden: (channel: string) => Uint8Array | undefined): void {
    for (const { channel, lines, positions, nodeIndex } of this.segments) {
      const mask = hidden(channel);
      const attr = lines.geometry.getAttribute('position') as THREE.BufferAttribute;
      const out = attr.array as Float32Array;
      let k = 0;
      nodeIndex.forEach((i, j) => {
        if (mask && mask[i] === 1) return;
        out.set(positions.subarray(6 * j, 6 * j + 6), k);
        k += 6;
      });
      attr.needsUpdate = true;
      lines.geometry.setDrawRange(0, k / 3);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const { lines } of this.segments) {
      lines.geometry.dispose();
      (lines.material as THREE.Material).dispose();
    }
    this.segments.length = 0;
  }
}
