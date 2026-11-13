/**
 * Export worker (spec multi-file-edit-diff Phase 4b "Worker side"): handles exactly one
 * `export` message, posts progress, then `done` or `error`. Never closes itself; the client
 * terminates it.
 */
import { buildExport } from './buildExport';
import type { ExportWorkerToMain, MainToExportWorker } from './client';
import { ExportError } from './errors';

const post = (msg: ExportWorkerToMain) => self.postMessage(msg);

let started = false;

self.onmessage = async (e: MessageEvent<MainToExportWorker>) => {
  const msg = e.data;
  if (started || !msg || typeof msg !== 'object' || msg.type !== 'export') return;
  started = true;
  const { gen, manifest, fileName } = msg;
  try {
    const { blob, warnings, unexpectedGlobals } = await buildExport(manifest, fileName, (p) =>
      post({ type: 'progress', gen, stage: p.stage, pct: p.pct }),
    );
    post({ type: 'done', gen, blob, byteLength: blob.size, warnings, unexpectedGlobals });
  } catch (err) {
    if (err instanceof ExportError) {
      post({ type: 'error', gen, message: err.message });
      return;
    }
    const e2 = err as { message?: unknown; stack?: unknown } | null;
    const message = `Internal error during export: ${String(e2?.message ?? err)}`;
    const detail = typeof e2?.stack === 'string' ? e2.stack : undefined;
    post(
      detail === undefined
        ? { type: 'error', gen, message }
        : { type: 'error', gen, message, detail },
    );
  }
};
