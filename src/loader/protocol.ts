/** Main ↔ worker message types (spec Phase 2 "Worker protocol"). */
import type { ModelFile } from '../model/types';

export type LoadStage = 'reading' | 'parsing' | 'building';
export type MainToWorker = { type: 'load'; gen: number; file: File };
export type WorkerToMain =
  | { type: 'progress'; gen: number; stage: LoadStage; pct?: number } // pct in 0..100 when known
  | { type: 'done'; gen: number; model: ModelFile }
  | { type: 'error'; gen: number; message: string; detail?: string }; // plain strings, never Error objects
