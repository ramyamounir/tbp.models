/**
 * Pose vectors of every node (sidebar POSE tab): the three rows of `pose_vectors`, one
 * screen-space-width `LineSegments2` per channel and row, in the colours of the selected-node glyph. Not pickable.
 *
 * - SM channel: row 0 is the surface normal, drawn from the node outwards; rows 1 and 2 are the
 *   principal curvature directions, which have no sign, so they are drawn centred on the node.
 *   With `smDefinedOnly` they are left out where `pose_fully_defined` (when the channel maps
 *   it) is not set: there the two directions are arbitrary.
 * - LM channel: rows 0 to 2 are the child object's x / y / z axes in the parent frame (see
 *   src/model/childPose.ts), drawn from the node outwards.
 */
import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { ChannelGraph, ObjectGraph } from '../model/types';
import { readToken } from '../theme/readToken';
import { cssToRgb } from './colors';

const OPACITY = 0.85;
const DIMMED_OPACITY = 0.2;

export type Vec3Flags = [boolean, boolean, boolean];

export interface PoseLayerOptions {
  /** Rows to draw for SM channels / LM channels (all false = none). */
  sm: Vec3Flags;
  lm: Vec3Flags;
  /** Leave out SM curvature directions of nodes whose pose is not fully defined. */
  smDefinedOnly: boolean;
  /** Vector length in model units. */
  length: number;
  /** Line width in CSS px. */
  widthPx: number;
}

/** CSS colours of the rows: SM `[normal, curv1, curv2]`, LM `[x, y, z]`. */
export interface PoseColors {
  sm: [string, string, string];
  lm: [string, string, string];
}

/** True when the channel maps a 9-wide (or wider) `pose_vectors`. */
export function hasPoseVectors(c: ChannelGraph): boolean {
  if (!Object.prototype.hasOwnProperty.call(c.features, 'pose_vectors')) return false;
  const [a, b] = c.features.pose_vectors;
  return b - a >= 9;
}

/**
 * Segment end points (6 floats each) and node row of each segment for row `k` of a channel.
 * Exported for tests.
 */
export function poseSegments(
  ch: ChannelGraph,
  k: number,
  length: number,
  definedOnly = false,
): { positions: Float32Array; nodeIndex: Int32Array } {
  const pv0 = ch.features.pose_vectors[0] + 3 * k;
  const centred = ch.kind === 'sm' && k > 0;
  const pfd =
    centred &&
    definedOnly &&
    Object.prototype.hasOwnProperty.call(ch.features, 'pose_fully_defined')
      ? ch.features.pose_fully_defined[0]
      : -1;
  const out = new Float32Array(ch.n * 6);
  const nodeIndex = new Int32Array(ch.n);
  let j = 0;
  for (let i = 0; i < ch.n; i++) {
    if (pfd >= 0 && !(ch.x[i * ch.F + pfd] >= 0.5)) continue;
    const px = ch.pos[3 * i];
    const py = ch.pos[3 * i + 1];
    const pz = ch.pos[3 * i + 2];
    const vx = ch.x[i * ch.F + pv0];
    const vy = ch.x[i * ch.F + pv0 + 1];
    const vz = ch.x[i * ch.F + pv0 + 2];
    const vl = Math.hypot(vx, vy, vz);
    if (!Number.isFinite(px + py + pz + vl) || vl <= 1e-9) continue;
    const s = length / vl;
    const back = centred ? 0.5 * s : 0;
    const fwd = centred ? 0.5 * s : s;
    out[6 * j] = px - vx * back;
    out[6 * j + 1] = py - vy * back;
    out[6 * j + 2] = pz - vz * back;
    out[6 * j + 3] = px + vx * fwd;
    out[6 * j + 4] = py + vy * fwd;
    out[6 * j + 5] = pz + vz * fwd;
    nodeIndex[j++] = i;
  }
  return { positions: out.slice(0, 6 * j), nodeIndex: nodeIndex.slice(0, j) };
}

/** The row colours from the design tokens (the selected-node glyph's colours). */
export function readPoseColors(): PoseColors {
  return {
    sm: [readToken('--glyph-normal'), readToken('--glyph-curv1'), readToken('--glyph-curv2')],
    lm: [readToken('--axis-x'), readToken('--axis-y'), readToken('--axis-z')],
  };
}

export class PoseLayer {
  readonly group = new THREE.Group();
  private readonly segments: {
    channel: string;
    kind: 'sm' | 'lm';
    row: number;
    lines: LineSegments2;
    geometry: LineSegmentsGeometry;
    material: LineMaterial;
    positions: Float32Array; // every segment (6 floats each)
    nodeIndex: Int32Array; // node row of each segment
  }[] = [];

  constructor(graph: ObjectGraph, opts: PoseLayerOptions, colors: PoseColors) {
    this.group.name = 'pose-vectors';
    for (const ch of graph.channels) {
      if (!hasPoseVectors(ch)) continue;
      const rows = ch.kind === 'sm' ? opts.sm : opts.lm;
      for (let k = 0; k < 3; k++) {
        if (!rows[k]) continue;
        const { positions, nodeIndex } = poseSegments(ch, k, opts.length, opts.smDefinedOnly);
        if (nodeIndex.length === 0) continue;
        const geometry = new LineSegmentsGeometry();
        geometry.setPositions(positions);
        // Screen-space width in CSS px, like the "Display as: Edges" segments.
        const material = new LineMaterial({
          linewidth: opts.widthPx,
          worldUnits: false,
          transparent: true,
          opacity: OPACITY,
          depthWrite: false,
        });
        const lines = new LineSegments2(geometry, material);
        lines.raycast = () => {};
        this.segments.push({
          channel: ch.channel,
          kind: ch.kind,
          row: k,
          lines,
          geometry,
          material,
          positions,
          nodeIndex,
        });
        this.group.add(lines);
      }
    }
    this.setColors(colors);
  }

  setColors(colors: PoseColors): void {
    for (const { kind, row, material } of this.segments) {
      const [r, g, b] = cssToRgb(colors[kind][row]);
      material.color.setRGB(r, g, b, THREE.SRGBColorSpace);
    }
  }

  setWidth(px: number): void {
    for (const { material } of this.segments) material.linewidth = px;
  }

  /** `selectedChannel` defined → other channels' segments are dimmed. */
  setDimmed(selectedChannel: string | undefined): void {
    for (const { channel, material } of this.segments) {
      const dim = selectedChannel !== undefined && channel !== selectedChannel;
      material.opacity = dim ? DIMMED_OPACITY : OPACITY;
    }
  }

  /** Leave out the vectors of nodes hidden from the legend (`hidden(channel)[i] === 1`). */
  setHidden(hidden: (channel: string) => Uint8Array | undefined): void {
    for (const { channel, lines, geometry, positions, nodeIndex } of this.segments) {
      const mask = hidden(channel);
      let shown = nodeIndex.length;
      if (mask) for (const i of nodeIndex) if (mask[i] === 1) shown--;
      lines.visible = shown > 0;
      if (shown === 0) continue;
      if (shown === nodeIndex.length) {
        geometry.setPositions(positions);
        continue;
      }
      const out = new Float32Array(shown * 6);
      let k = 0;
      nodeIndex.forEach((i, j) => {
        if (mask![i] === 1) return;
        out.set(positions.subarray(6 * j, 6 * j + 6), k);
        k += 6;
      });
      geometry.setPositions(out);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const { geometry, material } of this.segments) {
      geometry.dispose();
      material.dispose();
    }
    this.segments.length = 0;
  }
}
