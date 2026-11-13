/**
 * Main-thread glue between file pickers / drops and the store (spec multi-file-edit-diff
 * Phase 1 "Load controller"). Every opened file is *added* (never replaces the open ones):
 * `openModelFile` appends to a FIFO queue and returns immediately; one worker loads at a time.
 * Success → `openFile(file, stampOrigin(model, id), id)` (the file becomes active); a failure
 * keeps the already-open files and shows `LoadError`. Shared by the open-files list, the
 * no-file drop zone, the document-level drop handler and the top-bar button.
 */
import { newFileId, useViewerStore } from '../state/store';
import { getViewer } from '../viewer/sceneRegistry';
import { loadModelFile, stampOrigin, type LoadHandle } from './client';
import type { LoadStage } from './protocol';

interface QueuedLoad {
  file: File;
  t0: number;
}

const queue: QueuedLoad[] = [];
let active: LoadHandle | undefined;
/**
 * Error of an earlier load of the current batch (files queued while others were loading). Kept
 * on screen while the rest of the batch loads, so a failure is not hidden by the next file.
 */
let batchError: string | undefined;

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

/** Starts the next queued load when none is running. */
function pump(): void {
  if (active) return;
  const next = queue.shift();
  if (!next) return;
  const { file, t0 } = next;
  const setLoading = (loading: { stage: LoadStage; pct?: number }) =>
    batchError === undefined
      ? useViewerStore.getState().setLoading(loading)
      : useViewerStore.setState({ loading });
  const fail = (message: string) => {
    batchError = message;
    useViewerStore.getState().setError(message);
  };
  setLoading({ stage: 'reading' });
  let handle: LoadHandle;
  try {
    handle = loadModelFile(file, (p) => {
      if (active === handle) setLoading({ stage: p.stage, pct: p.pct });
    });
  } catch (err) {
    fail(`Could not start the loader: ${err instanceof Error ? err.message : String(err)}`);
    pump();
    return;
  }
  active = handle;
  const done = () => {
    active = undefined;
    if (queue.length === 0) batchError = undefined;
    pump();
  };
  handle.promise.then(
    (model) => {
      if (active !== handle) return;
      const id = newFileId();
      useViewerStore.getState().openFile(file, stampOrigin(model, id), id);
      if (batchError !== undefined) useViewerStore.setState({ error: batchError });
      logLoadTime(file, t0);
      done();
    },
    (err: unknown) => {
      if (active !== handle) return;
      fail(err instanceof Error ? err.message : String(err));
      done();
    },
  );
}

/**
 * Queues `file` to be opened as an additional file and returns immediately. Files load one at a
 * time in call order; each becomes active when it finishes. `t0` = `performance.now()` taken in
 * the drop/change event handler (load-time measurement).
 */
export function openModelFile(file: File, t0: number = performance.now()): void {
  if (!active && queue.length === 0) batchError = undefined; // a new batch starts
  queue.push({ file, t0 });
  pump();
}
