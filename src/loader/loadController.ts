/**
 * Main-thread glue between file pickers / drops and the store (spec Phase 2 Sidebar tasks).
 * Keeps the single active load handle: opening a new file cancels the in-flight load, a
 * `LoadCancelled` rejection is ignored, failures go to `setError`, success to one `setModel`.
 * Shared by the sidebar drop zone, the document-level drop handler and the top-bar button.
 */
import type { ModelFile } from '../model/types';
import { useViewerStore } from '../state/store';
import { getViewer } from '../viewer/sceneRegistry';
import { LoadCancelled, loadModelFile, type LoadHandle } from './client';

let active: LoadHandle | undefined;

/** First LM with >= 1 readable graph and its first graph id (graphId undefined if none). */
export function initialSelection(model: ModelFile): { lmId: number; graphId: string | undefined } {
  const lm = model.lms.find((l) => l.graphIds.length > 0);
  return lm ? { lmId: lm.lmId, graphId: lm.graphIds[0] } : { lmId: 0, graphId: undefined };
}

/**
 * Dev builds only: log the time from the drop/change event (`t0`) to the first frame rendered
 * after the model was stored (spec Phase 5 "Large-file check").
 */
function logLoadTime(file: File, t0: number): void {
  if (!import.meta.env.DEV) return;
  const viewer = getViewer();
  const report = () =>
    console.info(
      `[tbp-model-viewer] ${(file.size / 1e6).toFixed(1)} MB loaded and first frame rendered in ${Math.round(performance.now() - t0)} ms`,
    );
  if (!viewer) {
    requestAnimationFrame(report);
    return;
  }
  const off = viewer.onFrame(() => {
    off();
    report();
  });
}

/** `t0` = `performance.now()` taken in the drop/change event handler (load-time measurement). */
export function openModelFile(file: File, t0: number = performance.now()): void {
  const store = useViewerStore.getState();
  active?.cancel();
  store.setLoading({ stage: 'reading' });
  let handle: LoadHandle;
  try {
    handle = loadModelFile(file, (p) => {
      if (active === handle) useViewerStore.getState().setLoading({ stage: p.stage, pct: p.pct });
    });
  } catch (err) {
    store.setError(
      `Could not start the loader: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }
  active = handle;
  handle.promise.then(
    (model) => {
      if (active !== handle) return;
      active = undefined;
      const { lmId, graphId } = initialSelection(model);
      useViewerStore.getState().setModel(model, lmId, graphId);
      logLoadTime(file, t0);
    },
    (err: unknown) => {
      if (err instanceof LoadCancelled || active !== handle) return;
      active = undefined;
      useViewerStore.getState().setError(err instanceof Error ? err.message : String(err));
    },
  );
}
