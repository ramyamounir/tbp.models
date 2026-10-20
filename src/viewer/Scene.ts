/**
 * The main three.js viewport (spec Phase 3 "Scene graph" / "Scene API"). `createViewerScene` owns
 * the renderer, both cameras, `OrbitControls`, the render loop and the layers of the current
 * graph, and keeps them in sync with `useViewerStore`:
 *
 *   scene
 *   └── objectGroup (rotation = user Euler)
 *       └── modelFrameGroup (position = −centroid when display.center; never rotated)
 *           ├── Points per channel (raw pos)
 *           ├── edges per 2D-edge channel ("Display as: Edges", raw pos)
 *           ├── normals (optional, raw pos)
 *           ├── selection ring + pose glyph (raw node pos)
 *           └── overlayGroup (identity; Phase 4 overlays)
 *
 * No module-level singletons: other components reach the scene only via `sceneRegistry`.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { ChannelGraph, ObjectGraph } from '../model/types';
import { getGraph, useViewerStore, type Tool, type ViewerState } from '../state/store';
import { readToken } from '../theme/readToken';
import { displayName } from '../util/displayName';
import { computeColoring, cssToRgb, readThemeColors, type ThemeColors } from './colors';
import { EdgeLayer } from './EdgeLayer';
import { buildLmTriad, buildRingMarker, buildSmGlyph, disposeObject } from './Glyphs';
import { NormalsLayer } from './NormalsLayer';
import { Picker, type PickHit } from './Picker';
import { isEdgeChannel } from '../model/edges';
import { graphRadius, PointCloudLayer } from './PointCloudLayer';
import type { ViewerScene } from './sceneRegistry';

const FOV = 40;
const DEFAULT_DIR = new THREE.Vector3(0.55, 0.42, 1).normalize();
const FIT_MARGIN = 1.15;
const SELECT_RING_PX = 24;
const HOVER_RING_PX = 18;
const ROTATE_RAD_PER_PX = 0.008;

/** Normalized pose row + feature value helpers on a channel row. */
function featureSlice(c: ChannelGraph, i: number, name: string): Float64Array | undefined {
  if (!Object.prototype.hasOwnProperty.call(c.features, name)) return undefined;
  const [start, end] = c.features[name];
  return c.x.subarray(i * c.F + start, i * c.F + end);
}

function rawPos(c: ChannelGraph, i: number): THREE.Vector3 | null {
  const x = c.pos[3 * i];
  const y = c.pos[3 * i + 1];
  const z = c.pos[3 * i + 2];
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
  return new THREE.Vector3(x, y, z);
}

export function createViewerScene(container: HTMLElement): ViewerScene {
  // ---- renderer, cameras, controls -------------------------------------------------------
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.setAttribute('aria-label', 'Object graph point cloud');
  container.appendChild(canvas);

  const perspCam = new THREE.PerspectiveCamera(FOV, 1, 0.001, 100);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  let orthoHalfH = 1;
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspCam;
  perspCam.position.copy(DEFAULT_DIR);

  const controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
    perspCam,
    canvas,
  );
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.zoomToCursor = false;

  const scene = new THREE.Scene();
  const objectGroup = new THREE.Group();
  objectGroup.name = 'objectGroup';
  const modelFrameGroup = new THREE.Group();
  modelFrameGroup.name = 'modelFrameGroup';
  const overlayGroup = new THREE.Group();
  overlayGroup.name = 'overlayGroup';
  scene.add(objectGroup);
  objectGroup.add(modelFrameGroup);
  modelFrameGroup.add(overlayGroup);

  // Hover / selection label (DOM, text only).
  const label = document.createElement('div');
  label.className =
    'pointer-events-none absolute left-0 top-0 z-10 hidden whitespace-nowrap rounded-md bg-text px-2 py-1 font-mono text-[11px] text-panel shadow';
  const labelIdx = document.createElement('span');
  labelIdx.className = 'font-medium';
  const labelCh = document.createElement('span');
  labelCh.className = 'ml-1.5 opacity-70';
  label.append(labelIdx, labelCh);
  container.appendChild(label);

  // ---- per-graph state -------------------------------------------------------------------
  let graph: ObjectGraph | undefined;
  let layers: PointCloudLayer[] = [];
  let edges: EdgeLayer[] = [];
  let normals: NormalsLayer | null = null;
  let R = 0.01;
  let themeColors: ThemeColors = readThemeColors();
  let selectionGroup: THREE.Group | null = null;
  let hoverMarker: THREE.Points | null = null;
  let hover: PickHit | null = null;
  let lastLoadGen = -1;

  const st = () => useViewerStore.getState();
  const channelOf = (name: string) => layers.find((l) => l.channel.channel === name)?.channel;

  function applyBackground() {
    const [r, g, b] = cssToRgb(readToken('--viewport'));
    scene.background = new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);
  }

  function recolor() {
    const s = st();
    if (!graph || !s.model) return;
    const coloring = computeColoring(s.model, graph, s.colorMode, themeColors);
    const sel = s.selection;
    const bg = cssToRgb(readToken('--viewport'));
    layers.forEach((layer, k) => {
      const cc = coloring.channels[k];
      const dimChannel =
        s.display.dimOthers && sel !== undefined && sel.channel !== layer.channel.channel;
      layer.setColors(cc.colors, cc.dimmed, dimChannel);
      const e = edges.find((x) => x.channel === layer.channel);
      if (e) e.setColors(cc.colors, cc.dimmed, dimChannel, bg);
    });
    normals?.setDimmed(s.display.dimOthers ? sel?.channel : undefined);
  }

  function applyPointSize() {
    const d = st().display;
    for (const l of layers) l.setPointSize(d.pointSize, renderer.getPixelRatio());
    for (const e of edges) e.setWidth(d.edgeWidthPx);
  }

  /** "Display as": build/dispose the edge layers and hide the points they replace. */
  function rebuildEdges() {
    for (const e of edges) e.dispose();
    edges = [];
    const s = st();
    if (graph && s.display.displayAs === 'edges') {
      const halfLen = 0.5 * (s.display.edgeLengthPct / 100) * R;
      for (const c of graph.channels) {
        if (!isEdgeChannel(c)) continue;
        const e = new EdgeLayer(c, halfLen);
        edges.push(e);
        modelFrameGroup.add(e.lines);
      }
    }
    for (const l of layers) {
      const e = edges.find((x) => x.channel === l.channel);
      l.setHidden(e && e.segments.count > 0 ? e.hiddenMask : null);
    }
    applyPointSize();
    recolor();
  }

  function applyCenter() {
    const c = graph?.centroid;
    if (st().display.center && c) modelFrameGroup.position.set(-c[0], -c[1], -c[2]);
    else modelFrameGroup.position.set(0, 0, 0);
    modelFrameGroup.updateMatrixWorld(true);
  }

  function applyRotation() {
    const [x, y, z] = st().objectRotationDeg;
    const d = THREE.MathUtils.degToRad;
    objectGroup.rotation.set(d(x), d(y), d(z), 'XYZ');
    objectGroup.updateMatrixWorld(true);
  }

  function rebuildNormals() {
    normals?.dispose();
    normals = null;
    if (!graph || !st().display.showNormals) return;
    normals = new NormalsLayer(graph, R, readToken('--glyph-normal'));
    modelFrameGroup.add(normals.group);
    const s = st();
    normals.setDimmed(s.display.dimOthers ? s.selection?.channel : undefined);
  }

  function rebuildSelection() {
    if (selectionGroup) disposeObject(selectionGroup);
    selectionGroup = null;
    const sel = st().selection;
    const ch = sel && channelOf(sel.channel);
    const p = ch && sel.index >= 0 && sel.index < ch.n ? rawPos(ch, sel.index) : null;
    if (!sel || !ch || !p) return;
    const g = new THREE.Group();
    g.name = 'selection';
    g.position.copy(p);
    g.add(
      buildRingMarker({
        color: cssToRgb(readToken('--select')),
        sizePx: SELECT_RING_PX,
        pixelRatio: renderer.getPixelRatio(),
        fill: 0.18,
      }),
    );
    const row9 = featureSlice(ch, sel.index, 'pose_vectors');
    if (row9 && row9.length >= 9) {
      const scale = 0.08 * R;
      if (ch.kind === 'sm') {
        const pfd = featureSlice(ch, sel.index, 'pose_fully_defined');
        g.add(buildSmGlyph(row9, pfd !== undefined && pfd[0] >= 0.5, scale));
      } else {
        g.add(buildLmTriad(row9, scale));
      }
    }
    selectionGroup = g;
    modelFrameGroup.add(g);
  }

  function rebuildHover() {
    if (hoverMarker) disposeObject(hoverMarker);
    hoverMarker = null;
    const ch = hover && channelOf(hover.channel);
    const p = ch && hover ? rawPos(ch, hover.index) : null;
    if (!p) return;
    hoverMarker = buildRingMarker({
      color: cssToRgb(readToken('--accent')),
      sizePx: HOVER_RING_PX,
      pixelRatio: renderer.getPixelRatio(),
      opacity: 0.9,
    });
    hoverMarker.position.copy(p);
    modelFrameGroup.add(hoverMarker);
  }

  function rebuildGraph() {
    const s = st();
    for (const l of layers) l.dispose();
    layers = [];
    for (const e of edges) e.dispose();
    edges = [];
    normals?.dispose();
    normals = null;
    hover = null;
    picker.clearHover();
    rebuildHover();
    graph = getGraph(s.model, s.lmId, s.graphId);
    if (graph) {
      R = graphRadius(graph);
      for (const c of graph.channels) {
        const layer = new PointCloudLayer(c, graph.centroid);
        layers.push(layer);
        modelFrameGroup.add(layer.points);
      }
    } else {
      R = 0.01;
    }
    applyCenter();
    rebuildEdges(); // also applies point size and colors
    rebuildNormals();
    rebuildSelection();
    if (s.loadGen !== lastLoadGen) {
      lastLoadGen = s.loadGen;
      resetView();
    } else {
      fit();
    }
  }

  // ---- camera helpers --------------------------------------------------------------------
  function size() {
    return { w: Math.max(1, container.clientWidth), h: Math.max(1, container.clientHeight) };
  }

  function updateOrthoFrustum() {
    const { w, h } = size();
    const aspect = w / h;
    orthoCam.left = -orthoHalfH * aspect;
    orthoCam.right = orthoHalfH * aspect;
    orthoCam.top = orthoHalfH;
    orthoCam.bottom = -orthoHalfH;
    orthoCam.updateProjectionMatrix();
  }

  function worldCenter(): THREE.Vector3 {
    objectGroup.updateMatrixWorld(true);
    const c = graph?.centroid ?? [0, 0, 0];
    return modelFrameGroup.localToWorld(new THREE.Vector3(c[0], c[1], c[2]));
  }

  function setClipping(dist: number) {
    perspCam.near = Math.max(R * 1e-3, 1e-6);
    perspCam.far = dist * 20 + R * 50;
    perspCam.updateProjectionMatrix();
    orthoCam.near = -(dist * 20 + R * 50);
    orthoCam.far = dist * 20 + R * 50;
    controls.minDistance = R * 0.05;
    controls.maxDistance = dist * 15;
    controls.minZoom = 0.05;
    controls.maxZoom = 50;
  }

  function frame(dir: THREE.Vector3) {
    const { w, h } = size();
    const aspect = w / h;
    const vfov = THREE.MathUtils.degToRad(FOV);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = (FIT_MARGIN * R) / Math.sin(Math.min(vfov, hfov) / 2);
    const center = worldCenter();
    const pos = center.clone().addScaledVector(dir, dist);
    perspCam.position.copy(pos);
    perspCam.zoom = 1;
    orthoCam.position.copy(pos);
    orthoCam.zoom = 1;
    orthoHalfH = (FIT_MARGIN * R) / Math.min(1, aspect);
    updateOrthoFrustum();
    setClipping(dist);
    controls.target.copy(center);
    perspCam.lookAt(center);
    orthoCam.up.copy(perspCam.up);
    orthoCam.lookAt(center);
    controls.update();
  }

  function fit() {
    const dir = camera.position.clone().sub(controls.target);
    if (dir.lengthSq() < 1e-18 || !Number.isFinite(dir.x)) dir.copy(DEFAULT_DIR);
    frame(dir.normalize());
  }

  function resetView() {
    perspCam.up.set(0, 1, 0);
    orthoCam.up.set(0, 1, 0);
    frame(DEFAULT_DIR.clone());
  }

  function applyOrtho() {
    const want = st().ortho;
    const target = controls.target;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    if (want && camera === perspCam) {
      const dist = perspCam.position.distanceTo(target);
      orthoHalfH = Math.max(dist * tanHalf, 1e-6);
      orthoCam.position.copy(perspCam.position);
      orthoCam.quaternion.copy(perspCam.quaternion);
      orthoCam.up.copy(perspCam.up);
      orthoCam.zoom = 1;
      updateOrthoFrustum();
      camera = orthoCam;
    } else if (!want && camera === orthoCam) {
      const dist = orthoHalfH / orthoCam.zoom / tanHalf;
      const dir = orthoCam.position.clone().sub(target).normalize();
      perspCam.position.copy(target).addScaledVector(dir, dist);
      perspCam.up.copy(orthoCam.up);
      perspCam.zoom = 1;
      perspCam.updateProjectionMatrix();
      camera = perspCam;
    } else {
      return;
    }
    controls.object = camera;
    controls.update();
  }

  function applyTool(tool: Tool) {
    controls.enabled = true;
    controls.enableZoom = true;
    switch (tool) {
      case 'orbit':
        controls.enableRotate = true;
        controls.enablePan = true;
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
        canvas.style.cursor = 'default';
        break;
      case 'pan':
        controls.enableRotate = true;
        controls.enablePan = true;
        controls.mouseButtons = {
          LEFT: THREE.MOUSE.PAN,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.ROTATE,
        };
        canvas.style.cursor = 'move';
        break;
      case 'pick':
        controls.enableRotate = false;
        controls.enablePan = false;
        canvas.style.cursor = 'crosshair';
        break;
      case 'rotate':
        controls.enableRotate = false;
        controls.enablePan = false;
        canvas.style.cursor = 'grab';
        break;
    }
    if (tool === 'pan' || tool === 'rotate') picker.clearHover();
  }

  // ---- picking ---------------------------------------------------------------------------
  const picker = new Picker({
    dom: canvas,
    getCamera: () => camera,
    getLayers: () => layers,
    getPointSizePx: () => st().display.pointSize,
    getTool: () => st().tool,
    getTargetDistance: () => camera.position.distanceTo(controls.target),
    onHover: (hit) => {
      hover = hit;
      rebuildHover();
    },
    onClick: (hit) => st().setSelection({ channel: hit.channel, index: hit.index }),
  });

  // ---- rotate-object tool ----------------------------------------------------------------
  let rotDrag: { x: number; y: number; id: number } | null = null;
  const onRotDown = (e: PointerEvent) => {
    if (st().tool !== 'rotate' || e.button !== 0 || !e.isPrimary) return;
    rotDrag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = 'grabbing';
  };
  const onRotMove = (e: PointerEvent) => {
    if (!rotDrag || e.pointerId !== rotDrag.id) return;
    const dx = e.clientX - rotDrag.x;
    const dy = e.clientY - rotDrag.y;
    rotDrag.x = e.clientX;
    rotDrag.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const q = new THREE.Quaternion()
      .setFromAxisAngle(up, dx * ROTATE_RAD_PER_PX)
      .multiply(new THREE.Quaternion().setFromAxisAngle(right, dy * ROTATE_RAD_PER_PX))
      .multiply(objectGroup.quaternion);
    const eul = new THREE.Euler().setFromQuaternion(q.normalize(), 'XYZ');
    const deg = THREE.MathUtils.radToDeg;
    st().setRotation([deg(eul.x), deg(eul.y), deg(eul.z)]);
  };
  const onRotUp = (e: PointerEvent) => {
    if (!rotDrag || e.pointerId !== rotDrag.id) return;
    rotDrag = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
    if (st().tool === 'rotate') canvas.style.cursor = 'grab';
  };
  canvas.addEventListener('pointerdown', onRotDown);
  canvas.addEventListener('pointermove', onRotMove);
  canvas.addEventListener('pointerup', onRotUp);
  canvas.addEventListener('pointercancel', onRotUp);

  // ---- theme -----------------------------------------------------------------------------
  let themeFrame = 0;
  function refreshTheme() {
    themeColors = readThemeColors();
    applyBackground();
    recolor();
    normals?.setColor(readToken('--glyph-normal'));
    rebuildSelection();
    rebuildHover();
  }

  // ---- store sync ------------------------------------------------------------------------
  function onStore(s: ViewerState, p: ViewerState) {
    const g = getGraph(s.model, s.lmId, s.graphId);
    if (g !== graph || s.loadGen !== p.loadGen) {
      rebuildGraph();
    } else {
      const selChanged = s.selection !== p.selection;
      if (
        s.colorMode !== p.colorMode ||
        s.display.dimOthers !== p.display.dimOthers ||
        (selChanged && s.display.dimOthers)
      ) {
        recolor();
      }
      if (s.display.showNormals !== p.display.showNormals) rebuildNormals();
      if (
        s.display.displayAs !== p.display.displayAs ||
        s.display.edgeLengthPct !== p.display.edgeLengthPct
      ) {
        rebuildEdges();
      }
      if (s.display.center !== p.display.center) {
        applyCenter();
        fit();
      }
      if (selChanged) rebuildSelection();
    }
    if (
      s.display.pointSize !== p.display.pointSize ||
      s.display.edgeWidthPx !== p.display.edgeWidthPx
    )
      applyPointSize();
    if (s.objectRotationDeg !== p.objectRotationDeg) applyRotation();
    if (s.tool !== p.tool) applyTool(s.tool);
    if (s.ortho !== p.ortho) applyOrtho();
    if (s.resolvedTheme !== p.resolvedTheme) {
      cancelAnimationFrame(themeFrame);
      // Defer one frame so getComputedStyle sees the new data-theme attribute.
      themeFrame = requestAnimationFrame(refreshTheme);
    }
  }
  const unsubscribe = useViewerStore.subscribe(onStore);

  // ---- resize ----------------------------------------------------------------------------
  function resize() {
    const { w, h } = size();
    renderer.setSize(w, h, false);
    perspCam.aspect = w / h;
    perspCam.updateProjectionMatrix();
    updateOrthoFrustum();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);
  resize();

  // ---- render loop -----------------------------------------------------------------------
  const callbacks: ((dt: number) => void)[] = [];
  let raf = 0;
  let last = performance.now();
  let disposed = false;
  const tmp = new THREE.Vector3();

  function updateLabel() {
    const s = st();
    const target = hover ?? s.selection;
    const ch = target && channelOf(target.channel);
    const p = ch && target ? rawPos(ch, target.index) : null;
    if (!p || !target) {
      label.classList.add('hidden');
      return;
    }
    tmp.copy(p);
    modelFrameGroup.localToWorld(tmp);
    tmp.project(camera);
    if (tmp.z < -1 || tmp.z > 1) {
      label.classList.add('hidden');
      return;
    }
    const { w, h } = size();
    const x = (tmp.x * 0.5 + 0.5) * w;
    const y = (-tmp.y * 0.5 + 0.5) * h;
    labelIdx.textContent = `#${target.index}`;
    const d = displayName(target.channel, { max: 48 });
    labelCh.textContent = d.text;
    label.title = d.full;
    label.style.transform = `translate(${Math.round(x + 14)}px, ${Math.round(y - 30)}px)`;
    label.classList.remove('hidden');
  }

  function render() {
    renderer.render(scene, camera);
  }

  function loop() {
    if (disposed) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const dt = (now - last) / 1000;
    last = now;
    controls.update();
    updateLabel();
    render();
    for (const cb of [...callbacks]) {
      try {
        cb(dt);
      } catch (err) {
        console.error('onFrame callback failed', err);
      }
    }
  }

  // ---- initial state ---------------------------------------------------------------------
  applyBackground();
  applyTool(st().tool);
  applyRotation();
  rebuildGraph();
  applyOrtho();
  raf = requestAnimationFrame(loop);

  return {
    renderer,
    get camera() {
      return camera;
    },
    objectGroup,
    modelFrameGroup,
    overlayGroup,
    onFrame(cb) {
      callbacks.push(cb);
      return () => {
        const i = callbacks.indexOf(cb);
        if (i >= 0) callbacks.splice(i, 1);
      };
    },
    screenshot() {
      return new Promise<Blob>((resolve, reject) => {
        try {
          render();
          // Same task as the render: the drawing buffer is still valid.
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error('Canvas is empty'))),
            'image/png',
          );
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    },
    fit,
    resetView,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(themeFrame);
      callbacks.length = 0;
      unsubscribe();
      ro.disconnect();
      picker.dispose();
      canvas.removeEventListener('pointerdown', onRotDown);
      canvas.removeEventListener('pointermove', onRotMove);
      canvas.removeEventListener('pointerup', onRotUp);
      canvas.removeEventListener('pointercancel', onRotUp);
      controls.dispose();
      for (const l of layers) l.dispose();
      layers = [];
      for (const e of edges) e.dispose();
      edges = [];
      normals?.dispose();
      if (selectionGroup) disposeObject(selectionGroup);
      if (hoverMarker) disposeObject(hoverMarker);
      for (const child of [...overlayGroup.children]) disposeObject(child);
      renderer.dispose();
      renderer.forceContextLoss(); // release the GL context deterministically, not at GC time
      canvas.remove();
      label.remove();
    },
  };
}
