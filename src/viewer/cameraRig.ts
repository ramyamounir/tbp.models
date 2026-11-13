/**
 * Perspective + orthographic cameras with `OrbitControls`, shared by the main viewport
 * (`Scene.ts`) and the diff panes (`DiffScene.ts`, spec multi-file-edit-diff Phase 7a). The rig
 * frames a bounding sphere given by `bounds()`, switches projection while keeping the view, and
 * exposes its state so two rigs can be linked (side-by-side diff).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const FOV = 40;
export const DEFAULT_DIR = new THREE.Vector3(0.55, 0.42, 1).normalize();
const FIT_MARGIN = 1.15;

type Vec3 = [number, number, number];

/** Camera pose of a rig, enough to put another rig in the same view. */
export interface CameraState {
  position: Vec3;
  target: Vec3;
  up: Vec3;
  /** Camera zoom (ortho zoom; 1 for perspective unless changed). */
  zoom: number;
  /** Half height of the ortho frustum at zoom 1. */
  orthoHalfH: number;
}

export interface CameraRig {
  readonly perspCam: THREE.PerspectiveCamera;
  readonly orthoCam: THREE.OrthographicCamera;
  readonly controls: OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>;
  /** The active camera; changes with `setOrtho`. */
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  readonly isOrtho: boolean;
  /** Frame the bounding sphere from direction `dir` (unit vector). */
  frame(dir: THREE.Vector3): void;
  /** Frame the bounding sphere keeping the current view direction. */
  fit(): void;
  /** Default direction and up vector, then frame. */
  resetView(): void;
  /** Switch projection, keeping the view (no-op when already in that projection). */
  setOrtho(on: boolean): void;
  /** Apply the container size (aspect ratios and ortho frustum). */
  resize(): void;
  getState(): CameraState;
  setState(s: CameraState): void;
  dispose(): void;
}

export interface CameraRigOptions {
  canvas: HTMLElement;
  /** Container size in CSS px (at least 1 × 1). */
  size(): { w: number; h: number };
  /** World-space centre and radius of what `frame` / `fit` show. */
  bounds(): { center: THREE.Vector3; radius: number };
}

const vec = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

export function createCameraRig(opts: CameraRigOptions): CameraRig {
  const { size, bounds } = opts;
  const perspCam = new THREE.PerspectiveCamera(FOV, 1, 0.001, 100);
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100);
  let orthoHalfH = 1;
  let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera = perspCam;
  perspCam.position.copy(DEFAULT_DIR);

  const controls = new OrbitControls<THREE.PerspectiveCamera | THREE.OrthographicCamera>(
    perspCam,
    opts.canvas,
  );
  controls.enableDamping = true;
  controls.dampingFactor = 0.15;
  controls.zoomToCursor = false;

  function updateOrthoFrustum() {
    const { w, h } = size();
    const aspect = w / h;
    orthoCam.left = -orthoHalfH * aspect;
    orthoCam.right = orthoHalfH * aspect;
    orthoCam.top = orthoHalfH;
    orthoCam.bottom = -orthoHalfH;
    orthoCam.updateProjectionMatrix();
  }

  function setClipping(dist: number, R: number) {
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
    const { center, radius: R } = bounds();
    const vfov = THREE.MathUtils.degToRad(FOV);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const dist = (FIT_MARGIN * R) / Math.sin(Math.min(vfov, hfov) / 2);
    const pos = center.clone().addScaledVector(dir, dist);
    perspCam.position.copy(pos);
    perspCam.zoom = 1;
    orthoCam.position.copy(pos);
    orthoCam.zoom = 1;
    orthoHalfH = (FIT_MARGIN * R) / Math.min(1, aspect);
    updateOrthoFrustum();
    setClipping(dist, R);
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

  function setOrtho(want: boolean) {
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

  function resize() {
    const { w, h } = size();
    perspCam.aspect = w / h;
    perspCam.updateProjectionMatrix();
    updateOrthoFrustum();
  }

  function getState(): CameraState {
    return {
      position: vec(camera.position),
      target: vec(controls.target),
      up: vec(camera.up),
      zoom: camera.zoom,
      orthoHalfH,
    };
  }

  function setState(s: CameraState) {
    const cam = camera;
    cam.position.set(...s.position);
    cam.up.set(...s.up);
    controls.target.set(...s.target);
    if (cam === orthoCam && s.orthoHalfH > 0) {
      orthoHalfH = s.orthoHalfH;
      updateOrthoFrustum();
    }
    cam.zoom = s.zoom;
    cam.updateProjectionMatrix();
    cam.lookAt(controls.target);
    controls.update();
  }

  return {
    perspCam,
    orthoCam,
    controls,
    get camera() {
      return camera;
    },
    get isOrtho() {
      return camera === orthoCam;
    },
    frame,
    fit,
    resetView,
    setOrtho,
    resize,
    getState,
    setState,
    dispose() {
      controls.dispose();
    },
  };
}
