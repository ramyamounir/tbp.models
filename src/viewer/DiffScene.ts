/**
 * One pane of the diff view (spec multi-file-edit-diff Phase 7a "DiffScene"): a reduced sibling
 * of `Scene.ts` that draws one input channel of one or two models coloured by diff class.
 *
 *   scene
 *   └── group per channel (position = −offset, so A and B overlap as in the comparison)
 *       ├── Points (PointCloudLayer, raw pos)
 *       └── selection / hover rings (raw node pos)
 *
 * Cameras and controls come from `cameraRig.ts` (shared with the main viewport). Colours are the
 * Phase 1 diff tokens, re-read after a theme change. Node labels are DOM text only.
 */
import * as THREE from 'three';
import { NodeClass } from '../diff/compare';
import { channelCentroid, channelRadius } from '../diff/match';
import type { ChannelGraph } from '../model/types';
import { useViewerStore, type Tool } from '../state/store';
import { readToken } from '../theme/readToken';
import { createCameraRig, type CameraState } from './cameraRig';
import { cssToRgb, type RGB } from './colors';
import { buildRingMarker, disposeObject } from './Glyphs';
import { Picker, type PickHit } from './Picker';
import { PointCloudLayer } from './PointCloudLayer';

export type { CameraState } from './cameraRig';

type Vec3 = readonly [number, number, number];

/** Equal nodes are drawn small and slightly transparent; other classes at point size + 1. */
const EQUAL_POINT_PX = 3.5;
const EQUAL_ALPHA = 0.9;
const SELECT_RING_PX = 24;
const HOVER_RING_PX = 18;
const MIN_PRIORITY_LIFT = 0.005;

export interface DiffSceneGraph {
  /** The slot's input channel. */
  channel: ChannelGraph;
  /** The channel's group is translated by −offset. */
  offset: Vec3;
  /**
   * NodeClass per node. Undefined = no comparison (one slot filled): the channel is drawn
   * plainly in the default point colour.
   */
  classes?: Uint8Array;
  /** Which classes are drawn (hidden classes are also not pickable). */
  show: (cls: NodeClass) => boolean;
}

/** A node of one of the scene's channels (`graph` indexes `DiffSceneInput.graphs`). */
export interface DiffSceneNode {
  graph: 0 | 1;
  index: number;
  /** Text label next to the ring ("#212"); none when undefined. */
  label?: string;
}

export interface DiffSceneInput {
  graphs: DiffSceneGraph[];
  /** Ringed nodes: the selected node and, when paired, its partner. */
  selection?: DiffSceneNode[];
}

export interface DiffScene {
  setInput(input: DiffSceneInput): void;
  setPointSize(px: number): void;
  setTool(tool: Tool): void;
  getCamera(): CameraState;
  setCamera(s: CameraState): void;
  onCameraChange(cb: (s: CameraState) => void): () => void;
  /** The active camera (changes with `setOrtho`); read it every frame, never cache it. */
  readonly camera: THREE.Camera;
  /** Called after each rendered frame (dt in seconds); returns unsubscribe. Phase 7b glyph sync. */
  onFrame(cb: (dt: number) => void): () => void;
  pick(clientX: number, clientY: number): DiffSceneNode | null;
  fit(): void;
  resetView(): void;
  setOrtho(on: boolean): void;
  dispose(): void;
}

export interface DiffSceneOptions {
  /** A click on a node (orbit / pick tools); null is never passed for empty space. */
  onPick(hit: DiffSceneNode): void;
  ariaLabel?: string;
}

interface ClassColors {
  equal: RGB;
  changed: RGB;
  onlyA: RGB;
  onlyB: RGB;
  plain: RGB;
}

function readClassColors(): ClassColors {
  return {
    equal: cssToRgb(readToken('--diff-equal')),
    changed: cssToRgb(readToken('--diff-changed')),
    onlyA: cssToRgb(readToken('--diff-only-a')),
    onlyB: cssToRgb(readToken('--diff-only-b')),
    plain: cssToRgb(readToken('--point-default')),
  };
}

const classColor = (c: ClassColors, cls: number): RGB =>
  cls === NodeClass.Changed
    ? c.changed
    : cls === NodeClass.OnlyA
      ? c.onlyA
      : cls === NodeClass.OnlyB
        ? c.onlyB
        : c.equal;

interface GraphLayers {
  input: DiffSceneGraph;
  group: THREE.Group;
  layers: PointCloudLayer[];
}

/** Bounding radius of a channel about its centroid; 0.01 when degenerate (like `graphRadius`). */
function boundRadius(c: ChannelGraph): number {
  const r = channelRadius(c);
  return r >= 1e-6 ? r : 0.01;
}

export function createDiffScene(container: HTMLElement, opts: DiffSceneOptions): DiffScene {
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-label', opts.ariaLabel ?? 'Diff point cloud');
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const root = new THREE.Group();
  scene.add(root);

  let graphs: GraphLayers[] = [];
  let input: DiffSceneInput = { graphs: [] };
  let colors = readClassColors();
  let pointSize = 3;
  let tool: Tool = 'orbit';
  let R = 0.01;
  let center = new THREE.Vector3();
  let fitted = false;
  let rings: { node: DiffSceneNode; marker: THREE.Points; el: HTMLDivElement | null }[] = [];
  let hover: PickHit | null = null;
  let hoverMarker: THREE.Points | null = null;

  const size = () => ({
    w: Math.max(1, container.clientWidth),
    h: Math.max(1, container.clientHeight),
  });
  const rig = createCameraRig({ canvas, size, bounds: () => ({ center, radius: R }) });
  const controls = rig.controls;

  function applyBackground() {
    const [r, g, b] = cssToRgb(readToken('--viewport'));
    scene.background = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  }

  function applyPointSize() {
    const h = size().h;
    for (const g of graphs) {
      for (const l of g.layers) l.setPointSize(pointSize + 1, renderer.getPixelRatio(), h);
    }
  }

  function style() {
    const full = pointSize + 1;
    const equalScale = Math.min(1, EQUAL_POINT_PX / full);
    const plainScale = pointSize / full;
    for (const g of graphs) {
      const { classes, show } = g.input;
      for (const l of g.layers) {
        const c = l.channel;
        const n = c.n;
        const cls = classes;
        const col = new Float32Array(n * 3);
        const alpha = new Float32Array(n);
        const scale = new Float32Array(n);
        const prio = new Float32Array(n);
        for (let i = 0; i < n; i++) {
          let rgb: RGB;
          if (!classes) {
            rgb = colors.plain;
            alpha[i] = 1;
            scale[i] = plainScale;
          } else {
            const k = (cls && i < cls.length ? cls[i] : NodeClass.OnlyA) as NodeClass;
            rgb = classColor(colors, k);
            const shown = show(k);
            if (k === NodeClass.Equal) {
              alpha[i] = shown ? EQUAL_ALPHA : 0;
              scale[i] = equalScale;
            } else {
              alpha[i] = shown ? 1 : 0;
              scale[i] = 1;
              prio[i] = 1;
            }
          }
          col[3 * i] = rgb[0];
          col[3 * i + 1] = rgb[1];
          col[3 * i + 2] = rgb[2];
        }
        l.setNodeStyle(col, alpha, scale, prio);
      }
    }
  }

  function nodePos(node: { graph: number; index: number }): THREE.Vector3 | null {
    const c = graphs[node.graph]?.input.channel;
    if (!c || node.index < 0 || node.index >= c.n) return null;
    const x = c.pos[3 * node.index];
    const y = c.pos[3 * node.index + 1];
    const z = c.pos[3 * node.index + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    return new THREE.Vector3(x, y, z);
  }

  function clearRings() {
    for (const r of rings) {
      disposeObject(r.marker);
      r.el?.remove();
    }
    rings = [];
  }

  function rebuildRings() {
    clearRings();
    for (const node of input.selection ?? []) {
      const p = nodePos(node);
      const g = graphs[node.graph];
      if (!p || !g) continue;
      const marker = buildRingMarker({
        color: cssToRgb(readToken('--select')),
        sizePx: SELECT_RING_PX,
        pixelRatio: renderer.getPixelRatio(),
        fill: 0.18,
      });
      marker.position.copy(p);
      g.group.add(marker);
      let el: HTMLDivElement | null = null;
      if (node.label !== undefined) {
        el = document.createElement('div');
        el.className =
          'pointer-events-none absolute left-0 top-0 z-10 whitespace-nowrap rounded-md bg-text px-2 py-0.5 font-mono text-[11px] font-medium text-panel shadow';
        el.textContent = node.label;
        container.appendChild(el);
      }
      rings.push({ node, marker, el });
    }
  }

  function rebuildHover() {
    if (hoverMarker) disposeObject(hoverMarker);
    hoverMarker = null;
    if (!hover?.layer) return;
    const g = graphs.find((x) => x.layers.includes(hover!.layer!));
    const c = hover.layer.channel;
    const i = hover.index;
    if (!g || i < 0 || i >= c.n) return;
    hoverMarker = buildRingMarker({
      color: cssToRgb(readToken('--accent')),
      sizePx: HOVER_RING_PX,
      pixelRatio: renderer.getPixelRatio(),
      opacity: 0.9,
    });
    hoverMarker.position.set(c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]);
    g.group.add(hoverMarker);
  }

  function computeBounds() {
    const first = graphs[0];
    if (!first) {
      center = new THREE.Vector3();
      R = 0.01;
      return;
    }
    const centroidOf = (g: GraphLayers) => {
      const [cx, cy, cz] = channelCentroid(g.input.channel);
      const [ox, oy, oz] = g.input.offset;
      return new THREE.Vector3(cx - ox, cy - oy, cz - oz);
    };
    center = centroidOf(first);
    let r = 0;
    for (const g of graphs) {
      const d = centroidOf(g).distanceTo(center);
      r = Math.max(r, boundRadius(g.input.channel) + (Number.isFinite(d) ? d : 0));
    }
    R = r > 0 ? r : 0.01;
  }

  function disposeGraphs() {
    clearRings();
    if (hoverMarker) disposeObject(hoverMarker);
    hoverMarker = null;
    hover = null;
    for (const g of graphs) {
      for (const l of g.layers) l.dispose();
      g.group.removeFromParent();
    }
    graphs = [];
  }

  function rebuild(next: DiffSceneInput) {
    picker.clearHover();
    disposeGraphs();
    graphs = next.graphs.map((gi) => {
      const group = new THREE.Group();
      group.position.set(-gi.offset[0], -gi.offset[1], -gi.offset[2]);
      root.add(group);
      const lift = MIN_PRIORITY_LIFT * boundRadius(gi.channel);
      const [cx, cy, cz] = channelCentroid(gi.channel);
      const layer = new PointCloudLayer(gi.channel, [cx, cy, cz], lift);
      group.add(layer.points);
      return { input: gi, group, layers: [layer] };
    });
    root.updateMatrixWorld(true);
    computeBounds();
  }

  /** Same channels and offsets: only colours, visibility or selection changed. */
  const sameGraphs = (a: DiffSceneInput, b: DiffSceneInput) =>
    a.graphs.length === b.graphs.length &&
    a.graphs.every(
      (g, k) =>
        g.channel === b.graphs[k].channel &&
        g.offset[0] === b.graphs[k].offset[0] &&
        g.offset[1] === b.graphs[k].offset[1] &&
        g.offset[2] === b.graphs[k].offset[2],
    );

  // ---- tools and picking ---------------------------------------------------------------------
  function applyTool() {
    controls.enabled = true;
    controls.enableZoom = true;
    controls.enablePan = true;
    if (tool === 'pan') {
      controls.enableRotate = true;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.PAN,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.ROTATE,
      };
      canvas.style.cursor = 'move';
      picker.clearHover();
    } else if (tool === 'pick' || tool === 'rotate') {
      controls.enableRotate = false;
      controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: null };
      canvas.style.cursor = 'crosshair';
    } else {
      controls.enableRotate = true;
      controls.mouseButtons = {
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      };
      canvas.style.cursor = 'default';
    }
  }

  const allLayers = () => graphs.flatMap((g) => g.layers);
  const toNode = (hit: PickHit | null): DiffSceneNode | null => {
    if (!hit?.layer) return null;
    const k = graphs.findIndex((g) => g.layers.includes(hit.layer!));
    if (k !== 0 && k !== 1) return null;
    return { graph: k, index: hit.index };
  };

  const picker = new Picker({
    dom: canvas,
    getCamera: () => rig.camera,
    getLayers: allLayers,
    getPointSizePx: () => pointSize + 1,
    // The rotate tool does not exist in the diff view; treat it like pick.
    getTool: () => (tool === 'rotate' ? 'pick' : tool),
    getTargetDistance: () => rig.camera.position.distanceTo(controls.target),
    onHover: (hit) => {
      hover = hit;
      rebuildHover();
    },
    onClick: (hit) => {
      const node = toNode(hit);
      if (node) opts.onPick(node);
    },
  });

  // ---- theme ---------------------------------------------------------------------------------
  let themeFrame = 0;
  const unsubscribe = useViewerStore.subscribe((s, p) => {
    if (s.resolvedTheme === p.resolvedTheme) return;
    cancelAnimationFrame(themeFrame);
    themeFrame = requestAnimationFrame(() => {
      colors = readClassColors();
      applyBackground();
      style();
      rebuildRings();
      rebuildHover();
    });
  });

  // ---- resize --------------------------------------------------------------------------------
  function resize() {
    if (container.clientWidth === 0 || container.clientHeight === 0) return;
    const { w, h } = size();
    renderer.setSize(w, h, false);
    rig.resize();
    applyPointSize();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---- render loop ---------------------------------------------------------------------------
  let raf: number | null = null;
  let disposed = false;
  const tmp = new THREE.Vector3();

  function updateLabels() {
    const { w, h } = size();
    for (const r of rings) {
      if (!r.el) continue;
      r.marker.getWorldPosition(tmp);
      tmp.project(rig.camera);
      if (tmp.z < -1 || tmp.z > 1) {
        r.el.style.display = 'none';
        continue;
      }
      const x = (tmp.x * 0.5 + 0.5) * w;
      const y = (-tmp.y * 0.5 + 0.5) * h;
      r.el.style.display = '';
      r.el.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 12)}px)`;
    }
  }

  const frameCbs = new Set<(dt: number) => void>();
  let lastFrame = performance.now();

  function loop() {
    raf = null;
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    controls.update();
    updateLabels();
    renderer.render(scene, rig.camera);
    const now = performance.now();
    const dt = (now - lastFrame) / 1000;
    lastFrame = now;
    for (const cb of [...frameCbs]) cb(dt);
  }

  applyBackground();
  applyTool();
  raf = requestAnimationFrame(loop);

  return {
    setInput(next) {
      const rebuildNeeded = !sameGraphs(input, next);
      const prevSel = input.selection;
      input = next;
      if (rebuildNeeded) {
        rebuild(next);
        applyPointSize();
        style();
        rebuildRings();
        if (graphs.length > 0) {
          if (!fitted) rig.resetView();
          else rig.fit();
          fitted = true;
        }
        return;
      }
      // The layers are kept, but classes and visibility come from the new input: without this
      // the panes keep drawing the classes of the comparison they were built with.
      graphs.forEach((g, k) => {
        g.input = next.graphs[k];
      });
      style();
      if (prevSel !== next.selection) rebuildRings();
    },
    setPointSize(px) {
      if (!(px > 0) || px === pointSize) return;
      pointSize = px;
      applyPointSize();
      style();
    },
    setTool(t) {
      if (t === tool) return;
      tool = t;
      applyTool();
    },
    getCamera: () => rig.getState(),
    get camera() {
      return rig.camera;
    },
    onFrame(cb) {
      frameCbs.add(cb);
      return () => frameCbs.delete(cb);
    },
    setCamera(s) {
      // A linked pane that receives a camera keeps that view direction when it first frames.
      fitted = true;
      rig.setState(s);
    },
    onCameraChange(cb) {
      const handler = () => cb(rig.getState());
      controls.addEventListener('change', handler);
      return () => controls.removeEventListener('change', handler);
    },
    pick: (x, y) => toNode(picker.pick(x, y)),
    fit: () => rig.fit(),
    resetView: () => rig.resetView(),
    setOrtho: (on) => rig.setOrtho(on),
    dispose() {
      if (disposed) return;
      disposed = true;
      frameCbs.clear();
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      cancelAnimationFrame(themeFrame);
      unsubscribe();
      ro.disconnect();
      picker.dispose();
      rig.dispose();
      disposeGraphs();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
