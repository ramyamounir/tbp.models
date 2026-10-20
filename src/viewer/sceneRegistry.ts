/**
 * The only way React components outside `Viewport` reach the three.js scene (spec Phase 3
 * "Scene API"). A tiny dedicated zustand store, separate from `useViewerStore` because it holds
 * non-serializable three.js objects. `Viewport` registers the scene on mount and clears it on
 * unmount.
 */
import type * as THREE from 'three';
import { create } from 'zustand';

export interface ViewerScene {
  /** Main viewport renderer (antialias, preserveDrawingBuffer: false). */
  readonly renderer: THREE.WebGLRenderer;
  /** The ACTIVE camera; changes when `ortho` toggles. Read it every frame, never cache it. */
  readonly camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  /** rotation = user Euler (object rotation). */
  readonly objectGroup: THREE.Group;
  /** position = −centroid or 0; never rotated. Holds every layer in raw model coordinates. */
  readonly modelFrameGroup: THREE.Group;
  /** Child of modelFrameGroup, identity transform; reserved for Phase 4 overlays. */
  readonly overlayGroup: THREE.Group;
  /** dt in seconds since the previous frame; returns unsubscribe. */
  onFrame(cb: (dt: number) => void): () => void;
  /** PNG of the main canvas. */
  screenshot(): Promise<Blob>;
  /** Frame the world-space bounding sphere of modelFrameGroup's content. */
  fit(): void;
  /** Default camera direction + fit(); does not touch objectGroup rotation. */
  resetView(): void;
  /** Called only by Viewport on unmount. */
  dispose(): void;
}

export const useSceneRegistry = create<{ viewer: ViewerScene | null }>(() => ({ viewer: null }));
export const setViewer = (v: ViewerScene | null) => useSceneRegistry.setState({ viewer: v });
export const getViewer = () => useSceneRegistry.getState().viewer;
export const useViewer = () => useSceneRegistry((s) => s.viewer);
