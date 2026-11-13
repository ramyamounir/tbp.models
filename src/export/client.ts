/**
 * Main-thread export client (spec multi-file-edit-diff Phase 4b "Worker"): one worker per
 * export, a generation check on every message, validation of `progress` / `done` / `error`,
 * and termination of the worker on done, error and cancel.
 */
import { ExportCancelledError } from './cancel';
import type { ExportManifest } from './manifest';

export { ExportCancelledError };

export type WorkerStage = 'reading' | 'parsing' | 'rebuilding' | 'writing' | 'verifying';
/** 'hashing' is reported on the main thread by buildManifest. */
export type ExportStage = 'hashing' | WorkerStage;
export type ProgressFn = (p: { stage: ExportStage; pct?: number }) => void;

export type MainToExportWorker = {
  type: 'export';
  gen: number;
  manifest: ExportManifest;
  fileName: string;
};
export type ExportWorkerToMain =
  | { type: 'progress'; gen: number; stage: WorkerStage; pct?: number }
  | {
      type: 'done';
      gen: number;
      blob: Blob;
      byteLength: number;
      warnings: string[];
      unexpectedGlobals: string[];
    }
  | { type: 'error'; gen: number; message: string; detail?: string };

export interface ExportResult {
  blob: Blob;
  warnings: string[];
  unexpectedGlobals: string[];
}

/** Rejection of exportFile for an error reported by the worker (or a worker crash / invalid message). */
export class ExportWorkerError extends Error {
  override name = 'ExportWorkerError';
  readonly detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.detail = detail;
  }
}

const WORKER_STAGES: readonly string[] = [
  'reading',
  'parsing',
  'rebuilding',
  'writing',
  'verifying',
];

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

let nextGen = 0;

export function exportFile(
  manifest: ExportManifest,
  fileName: string,
  onProgress: ProgressFn,
): { promise: Promise<ExportResult>; cancel(): void } {
  const gen = ++nextGen;
  const worker = new Worker(new URL('./exportWorker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let settle!: { resolve(r: ExportResult): void; reject(e: Error): void };
  const promise = new Promise<ExportResult>((resolve, reject) => (settle = { resolve, reject }));
  const finish = (f: () => void) => {
    settled = true;
    worker.terminate();
    f();
  };

  worker.onmessage = (e: MessageEvent<unknown>) => {
    if (settled) return;
    const msg = e.data as Record<string, unknown> | null;
    if (!msg || typeof msg !== 'object' || msg.gen !== gen) return;
    switch (msg.type) {
      case 'progress': {
        const pct = msg.pct;
        const pctOk =
          pct === undefined ||
          (typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100);
        if (typeof msg.stage === 'string' && WORKER_STAGES.includes(msg.stage) && pctOk) {
          onProgress({ stage: msg.stage as WorkerStage, pct: pct as number | undefined });
        }
        return;
      }
      case 'done': {
        const { blob, byteLength, warnings, unexpectedGlobals } = msg;
        const ok =
          blob instanceof Blob &&
          typeof byteLength === 'number' &&
          Number.isSafeInteger(byteLength) &&
          byteLength === blob.size &&
          isStringArray(warnings) &&
          isStringArray(unexpectedGlobals);
        if (ok) {
          finish(() => settle.resolve({ blob, warnings, unexpectedGlobals }));
        } else {
          finish(() =>
            settle.reject(new ExportWorkerError('Export worker returned an invalid result')),
          );
        }
        return;
      }
      case 'error': {
        const message = typeof msg.message === 'string' ? msg.message : 'Export failed';
        const detail = typeof msg.detail === 'string' ? msg.detail : undefined;
        finish(() => settle.reject(new ExportWorkerError(message, detail)));
        return;
      }
      default:
        return;
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    if (settled) return;
    e.preventDefault?.();
    const detail = typeof e.message === 'string' && e.message !== '' ? e.message : undefined;
    finish(() => settle.reject(new ExportWorkerError('Export worker failed', detail)));
  };
  worker.onmessageerror = () => {
    if (settled) return;
    finish(() => settle.reject(new ExportWorkerError('Export worker failed')));
  };

  const msg: MainToExportWorker = { type: 'export', gen, manifest, fileName };
  worker.postMessage(msg);

  return {
    promise,
    cancel() {
      if (settled) return;
      finish(() => settle.reject(new ExportCancelledError()));
    },
  };
}
