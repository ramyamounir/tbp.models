/**
 * Loader worker: handles exactly one `{type: 'load'}` message, then the client terminates it.
 * Posts only the validated `ModelFile` (never raw pickle objects) with a de-duplicated
 * transfer list (spec Phase 2 "Worker protocol", "Transfer rules").
 */
import { ParseError } from './errors';
import { parseModelFile } from './parse';
import type { MainToWorker, WorkerToMain } from './protocol';

const post = (msg: WorkerToMain, transfer: Transferable[] = []) =>
  self.postMessage(msg, { transfer });

let started = false;

self.onmessage = async (e: MessageEvent<MainToWorker>) => {
  const msg = e.data;
  if (started || !msg || typeof msg !== 'object' || msg.type !== 'load') return;
  started = true;
  const { gen, file } = msg;
  try {
    const model = await parseModelFile(file, file.name, (stage, pct) =>
      post({ type: 'progress', gen, stage, pct }),
    );
    const buffers = new Set<ArrayBuffer>();
    for (const lm of model.lms) {
      for (const g of lm.graphs.values()) {
        for (const c of g.channels) {
          buffers.add(c.pos.buffer as ArrayBuffer);
          buffers.add(c.x.buffer as ArrayBuffer);
        }
      }
    }
    post({ type: 'done', gen, model }, [...buffers]);
  } catch (err) {
    const message =
      err instanceof ParseError
        ? err.message
        : `Unexpected error while reading the model: ${err instanceof Error ? err.message : String(err)}`;
    const detail = err instanceof Error && typeof err.stack === 'string' ? err.stack : undefined;
    post({ type: 'error', gen, message: String(message), detail });
  }
};
