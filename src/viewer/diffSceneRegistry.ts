/**
 * The diff view's scenes (spec multi-file-edit-diff Phase 7b): pane 0 and, in Side by side,
 * pane 1. `DiffViewport` registers them; the keyboard handler (`F` fits) and the node diff
 * panel's pose glyph (camera sync) read them. Separate from `useViewerStore` because it holds
 * three.js objects.
 */
import { create } from 'zustand';
import type { DiffScene } from './DiffScene';

export const useDiffScenes = create<{ scenes: readonly (DiffScene | null)[] }>(() => ({
  scenes: [null, null],
}));

export function setDiffScene(pane: 0 | 1, scene: DiffScene | null): void {
  const prev = useDiffScenes.getState().scenes;
  if (prev[pane] === scene) return;
  const next = [...prev];
  next[pane] = scene;
  useDiffScenes.setState({ scenes: next });
}

/** Every live diff scene. */
export const getDiffScenes = (): DiffScene[] =>
  useDiffScenes.getState().scenes.filter((s): s is DiffScene => s !== null);

/** The first pane's scene (the camera every pane is linked to). */
export const usePrimaryDiffScene = () => useDiffScenes((s) => s.scenes[0] ?? s.scenes[1] ?? null);
