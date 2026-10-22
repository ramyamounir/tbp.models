/**
 * "Display as: Edges": one screen-space-width `LineSegments2` per 2D-edge channel (see
 * src/model/edges.ts for the geometry and the tbp.monty / tbp.teleop background). Segments are
 * centered on the node in raw (uncentered) model coordinates, so they live under
 * `modelFrameGroup` like the points and follow object rotation and centering. Not pickable: the
 * node's (hidden) point under the segment's center still takes hover and click.
 *
 * `LineMaterial` has no per-vertex alpha, so per-node dimming blends the color toward the
 * viewport background by `DIM_ALPHA` (what alpha 0.25 looks like over the background); whole
 * channel dimming ("Dim nodes not in selected channel") uses the material opacity.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { buildEdgeSegments, type EdgeSegments } from '../model/edges';
import type { ChannelGraph } from '../model/types';
import type { RGB } from './colors';
import { DIM_ALPHA } from './PointCloudLayer';

const tmp = new THREE.Color();

export class EdgeLayer {
  readonly channel: ChannelGraph;
  readonly segments: EdgeSegments;
  readonly lines: LineSegments2;
  private readonly geometry: LineSegmentsGeometry;
  private readonly material: LineMaterial;
  /** Positions currently in the geometry (`segments.positions` unless some nodes are hidden). */
  private drawnPositions: Float32Array | null = null;

  /** `halfLen` in model units (edge length = 2 × halfLen). */
  constructor(channel: ChannelGraph, halfLen: number) {
    this.channel = channel;
    this.segments = buildEdgeSegments(channel, halfLen);
    this.geometry = new LineSegmentsGeometry();
    if (this.segments.count > 0) {
      this.geometry.setPositions(this.segments.positions);
      this.drawnPositions = this.segments.positions;
      this.geometry.setColors(new Float32Array(this.segments.count * 6));
    }
    this.material = new LineMaterial({
      vertexColors: true,
      linewidth: 1,
      worldUnits: false,
      transparent: true,
      opacity: 1,
      depthWrite: true,
    });
    this.lines = new LineSegments2(this.geometry, this.material);
    this.lines.name = `edges:${channel.channel}`;
    this.lines.raycast = () => {};
    this.lines.visible = this.segments.count > 0;
    this.lines.computeLineDistances();
  }

  /** Nodes drawn as segments (to hide their points). */
  get hiddenMask(): Uint8Array {
    return this.segments.hidden;
  }

  /**
   * `colors` (n*3 sRGB), per-node dim flags and legend-hidden flags, as for
   * `PointCloudLayer.setColors`; `bg` is the viewport background used to fake per-node alpha.
   * Hidden nodes' segments are left out of the geometry.
   */
  setColors(
    colors: Float32Array,
    dimmed: Uint8Array,
    hidden: Uint8Array,
    dimWholeChannel: boolean,
    bg: RGB,
  ): void {
    const { count, nodeIndex, positions } = this.segments;
    if (count === 0) return;
    let shown = 0;
    for (let k = 0; k < count; k++) if (hidden[nodeIndex[k]] !== 1) shown++;
    this.lines.visible = shown > 0;
    if (shown === 0) return;
    const out = new Float32Array(shown * 6);
    const pos = shown === count ? positions : new Float32Array(shown * 6);
    const rgb = [0, 0, 0];
    for (let k = 0, j = -1; k < count; k++) {
      const i = nodeIndex[k];
      if (hidden[i] === 1) continue;
      j++;
      if (pos !== positions) pos.set(positions.subarray(6 * k, 6 * k + 6), 6 * j);
      const dim = dimmed[i] === 1;
      for (let c = 0; c < 3; c++) {
        const v = colors[3 * i + c];
        rgb[c] = dim ? bg[c] + (v - bg[c]) * DIM_ALPHA : v;
      }
      // Coloring is sRGB; LineMaterial multiplies vertex colors in the (linear) working color
      // space and converts on output, unlike the points shader which writes sRGB as-is.
      tmp.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
      out[6 * j] = out[6 * j + 3] = tmp.r;
      out[6 * j + 1] = out[6 * j + 4] = tmp.g;
      out[6 * j + 2] = out[6 * j + 5] = tmp.b;
    }
    if (pos !== this.drawnPositions) {
      this.geometry.setPositions(pos);
      this.drawnPositions = pos;
    }
    this.geometry.setColors(out);
    this.material.opacity = dimWholeChannel ? DIM_ALPHA : 1;
  }

  setWidth(px: number): void {
    this.material.linewidth = px;
  }

  dispose(): void {
    this.lines.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
  }
}
