/**
 * Node picking (spec Phase 3 "Picking"): `Raycaster` on the channel `Points` with the threshold
 * scaled to the point size, nearest-to-ray wins (tie → depth). Hover and click-select are active
 * for the `orbit` and `pick` tools only; a press counts as a click when the pointer moved ≤ 4 CSS
 * px and the press lasted < 500 ms (otherwise it was an orbit drag).
 */
import * as THREE from 'three';
import type { Tool } from '../state/store';
import type { PointCloudLayer } from './PointCloudLayer';

export interface PickHit {
  channel: string;
  index: number;
}

export interface PickerOptions {
  dom: HTMLElement;
  getCamera(): THREE.PerspectiveCamera | THREE.OrthographicCamera;
  getLayers(): readonly PointCloudLayer[];
  getPointSizePx(): number;
  getTool(): Tool;
  /** Distance from the camera to the orbit target (world units). */
  getTargetDistance(): number;
  onHover(hit: PickHit | null): void;
  onClick(hit: PickHit): void;
}

const CLICK_MAX_MOVE_PX = 4;
const CLICK_MAX_MS = 500;

const pickingTool = (t: Tool) => t === 'orbit' || t === 'pick';

/** World units per CSS pixel at `distance` from the camera. */
export function worldPerPixel(
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera,
  distance: number,
  heightPx: number,
): number {
  if (heightPx <= 0) return 0;
  if (camera instanceof THREE.OrthographicCamera) {
    return (camera.top - camera.bottom) / camera.zoom / heightPx;
  }
  const fov = THREE.MathUtils.degToRad(camera.fov);
  return (2 * distance * Math.tan(fov / 2)) / camera.zoom / heightPx;
}

export class Picker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private down: { x: number; y: number; t: number; id: number } | null = null;
  private hoverFrame = 0;
  private lastMove: { x: number; y: number } | null = null;
  private hovered: PickHit | null = null;
  private readonly opts: PickerOptions;

  constructor(opts: PickerOptions) {
    this.opts = opts;
    const d = opts.dom;
    d.addEventListener('pointerdown', this.onDown);
    d.addEventListener('pointerup', this.onUp);
    d.addEventListener('pointermove', this.onMove);
    d.addEventListener('pointerleave', this.onLeave);
    d.addEventListener('pointercancel', this.onCancel);
  }

  /** Raycast at client coordinates; null when nothing pickable is under the pointer. */
  pick(clientX: number, clientY: number): PickHit | null {
    const rect = this.opts.dom.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    this.ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const camera = this.opts.getCamera();
    const layers = this.opts.getLayers();
    if (layers.length === 0) return null;
    const wpp = worldPerPixel(camera, this.opts.getTargetDistance(), rect.height);
    const radiusPx = this.opts.getPointSizePx() / 2 + 3;
    this.raycaster.params.Points = { threshold: Math.max(radiusPx * wpp, 1e-9) };
    this.raycaster.setFromCamera(this.ndc, camera);
    let best: { hit: PickHit; ray: number; depth: number } | null = null;
    for (const layer of layers) {
      if (!layer.points.visible) continue;
      for (const it of this.raycaster.intersectObject(layer.points, false)) {
        const i = it.index;
        if (i === undefined || !layer.isPickable(i)) continue;
        const ray = it.distanceToRay ?? Infinity;
        if (
          !best ||
          ray < best.ray - 1e-12 ||
          (Math.abs(ray - best.ray) <= 1e-12 && it.distance < best.depth)
        ) {
          best = { hit: { channel: layer.channel.channel, index: i }, ray, depth: it.distance };
        }
      }
    }
    return best?.hit ?? null;
  }

  /** Clear the hover state (e.g. when the tool changes or the graph is rebuilt). */
  clearHover(): void {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    if (this.hovered) {
      this.hovered = null;
      this.opts.onHover(null);
    }
  }

  private setHover(hit: PickHit | null) {
    const same =
      hit === this.hovered ||
      (hit &&
        this.hovered &&
        hit.channel === this.hovered.channel &&
        hit.index === this.hovered.index);
    if (same) return;
    this.hovered = hit;
    this.opts.onHover(hit);
  }

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0 || !e.isPrimary) return;
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
  };

  private readonly onUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || e.pointerId !== d.id || e.button !== 0) return;
    if (!pickingTool(this.opts.getTool())) return;
    const moved = Math.hypot(e.clientX - d.x, e.clientY - d.y);
    if (moved > CLICK_MAX_MOVE_PX || performance.now() - d.t >= CLICK_MAX_MS) return;
    const hit = this.pick(e.clientX, e.clientY);
    if (hit) this.opts.onClick(hit); // a click on empty space does nothing
  };

  private readonly onMove = (e: PointerEvent) => {
    if (!pickingTool(this.opts.getTool())) {
      this.clearHover();
      return;
    }
    if (e.buttons !== 0) return; // dragging: keep the current hover
    this.lastMove = { x: e.clientX, y: e.clientY };
    if (this.hoverFrame) return;
    this.hoverFrame = requestAnimationFrame(() => {
      this.hoverFrame = 0;
      const m = this.lastMove;
      if (!m || !pickingTool(this.opts.getTool())) return;
      this.setHover(this.pick(m.x, m.y));
    });
  };

  private readonly onLeave = () => {
    this.lastMove = null;
    this.clearHover();
  };

  private readonly onCancel = () => {
    this.down = null;
  };

  dispose(): void {
    cancelAnimationFrame(this.hoverFrame);
    const d = this.opts.dom;
    d.removeEventListener('pointerdown', this.onDown);
    d.removeEventListener('pointerup', this.onUp);
    d.removeEventListener('pointermove', this.onMove);
    d.removeEventListener('pointerleave', this.onLeave);
    d.removeEventListener('pointercancel', this.onCancel);
  }
}
