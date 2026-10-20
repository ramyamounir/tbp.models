/**
 * Main-thread loader client (spec Phase 2 "Client and cancellation", "Main-thread
 * validation"). One worker per load; a newer load or `cancel()` terminates the previous one,
 * and messages from stale generations are dropped.
 */
import type {
  ChannelGraph,
  ModelFile,
  ObjectGraph,
  ObjectIdCandidate,
  ObjectIdIndex,
  UnreadableGraph,
} from '../model/types';
import type { LoadStage, MainToWorker, WorkerToMain } from './protocol';

let currentGen = 0;

export class LoadCancelled extends Error {
  override name = 'LoadCancelled';
  constructor() {
    super('Load cancelled');
  }
}

export interface LoadHandle {
  promise: Promise<ModelFile>;
  cancel(): void;
}

export function loadModelFile(
  file: File,
  onProgress: (p: { stage: LoadStage; pct?: number }) => void,
): LoadHandle {
  const gen = ++currentGen; // monotonically increasing; independent of the store's loadGen
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let settle!: { resolve(m: ModelFile): void; reject(e: Error): void };
  const promise = new Promise<ModelFile>((resolve, reject) => (settle = { resolve, reject }));
  const fail = (message: string) => {
    worker.terminate();
    settle.reject(new Error(message));
  };
  worker.onmessage = (e: MessageEvent<unknown>) => {
    const msg = e.data as WorkerToMain;
    if (!msg || typeof msg !== 'object' || msg.gen !== gen || gen !== currentGen) return; // stale: drop
    switch (msg.type) {
      case 'progress':
        if (msg.stage === 'reading' || msg.stage === 'parsing' || msg.stage === 'building') {
          const pct =
            typeof msg.pct === 'number' && Number.isFinite(msg.pct)
              ? Math.min(100, Math.max(0, msg.pct))
              : undefined;
          onProgress({ stage: msg.stage, pct });
        }
        return;
      case 'done':
        worker.terminate();
        try {
          settle.resolve(validateModelFile(msg.model));
        } catch (err) {
          settle.reject(err instanceof Error ? err : new Error(String(err)));
        }
        return;
      case 'error':
        fail(String(msg.message));
        return;
      default:
        return; // unknown type: ignore
    }
  };
  worker.onerror = (e: ErrorEvent) => {
    e.preventDefault();
    fail(`Unexpected error while reading the model: ${e.message || 'the loader worker failed'}`);
  };
  worker.onmessageerror = () =>
    fail('Unexpected error while reading the model: could not receive the loader result');
  worker.postMessage({ type: 'load', gen, file } satisfies MainToWorker);
  return {
    promise,
    cancel() {
      worker.terminate();
      settle.reject(new LoadCancelled());
    },
  };
}

class ShapeError extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const isIdx = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

function check(cond: unknown, path: string): asserts cond {
  if (!cond) throw new ShapeError(path);
}

function validateChannel(c: unknown, path: string): ChannelGraph {
  check(isObj(c), path);
  const { channel, kind, n, pos, x, F, features, nonFiniteRows } = c;
  check(typeof channel === 'string', `${path}.channel`);
  check(kind === 'sm' || kind === 'lm', `${path}.kind`);
  check(isIdx(n), `${path}.n`);
  check(isIdx(F), `${path}.F`);
  check(pos instanceof Float64Array && pos.length === 3 * n, `${path}.pos`);
  check(x instanceof Float64Array && x.length === n * F, `${path}.x`);
  check(isIdx(nonFiniteRows) && nonFiniteRows <= n, `${path}.nonFiniteRows`);
  check(isObj(features) && !Array.isArray(features), `${path}.features`);
  // Rebuild with a null prototype so lookups of absent names (`constructor`, ...) are undefined.
  const clean = Object.create(null) as Record<string, [number, number]>;
  for (const [k, r] of Object.entries(features)) {
    check(
      Array.isArray(r) &&
        r.length === 2 &&
        Number.isInteger(r[0]) &&
        Number.isInteger(r[1]) &&
        0 <= r[0] &&
        r[0] < r[1] &&
        r[1] <= F,
      `${path}.features`,
    );
    clean[k] = [r[0], r[1]];
  }
  return { channel, kind, n, pos, x, F, features: clean, nonFiniteRows };
}

/** Validate the `done.model` shape before it reaches the store; throws a readable error. */
export function validateModelFile(m: unknown): ModelFile {
  try {
    check(isObj(m), 'model');
    check(typeof m.fileName === 'string', 'fileName');
    check(typeof m.byteLength === 'number', 'byteLength');
    check(Array.isArray(m.lms), 'lms');
    const lms: ModelFile['lms'] = m.lms.map((lm: unknown, i: number) => {
      const p = `lms[${i}]`;
      check(isObj(lm) && lm.lmId === i, `${p}.lmId`);
      check(
        Array.isArray(lm.graphIds) && lm.graphIds.every((g) => typeof g === 'string'),
        `${p}.graphIds`,
      );
      check(lm.graphs instanceof Map, `${p}.graphs`);
      check(Array.isArray(lm.unreadable), `${p}.unreadable`);
      const graphs = new Map<string, ObjectGraph>();
      for (const [gid, g] of (lm.graphs as Map<unknown, unknown>).entries()) {
        const gp = `${p}.graphs`;
        check(typeof gid === 'string' && isObj(g) && g.graphId === gid && g.lmId === i, gp);
        check(Array.isArray(g.channels), `${gp}.channels`);
        check(
          Array.isArray(g.centroid) &&
            g.centroid.length === 3 &&
            g.centroid.every((v) => typeof v === 'number'),
          `${gp}.centroid`,
        );
        const channels = g.channels.map((c: unknown, k: number) =>
          validateChannel(c, `${gp}.channels[${k}]`),
        );
        graphs.set(gid, {
          lmId: i,
          graphId: gid,
          channels,
          centroid: g.centroid as [number, number, number],
        });
      }
      check(
        (lm.graphIds as string[]).every((g) => graphs.has(g)),
        `${p}.graphIds`,
      );
      const unreadable: UnreadableGraph[] = (lm.unreadable as unknown[]).map((u) => {
        check(
          isObj(u) && typeof u.graphId === 'string' && typeof u.reason === 'string',
          `${p}.unreadable`,
        );
        return { graphId: u.graphId as string, reason: u.reason as string };
      });
      return { lmId: i, graphIds: (lm.graphIds as string[]).slice(), graphs, unreadable };
    });
    const isMatrix = (v: unknown): v is number[][] =>
      Array.isArray(v) && v.every((r) => Array.isArray(r) && r.every((e) => typeof e === 'number'));
    check(isMatrix(m.lmToLm), 'lmToLm');
    check(isMatrix(m.smToLm), 'smToLm');
    check(m.objectIdIndex instanceof Map, 'objectIdIndex');
    const index: ObjectIdIndex = new Map();
    for (const [lmId, inner] of (m.objectIdIndex as Map<unknown, unknown>).entries()) {
      check(isIdx(lmId) && inner instanceof Map, 'objectIdIndex');
      const out = new Map<number, ObjectIdCandidate[]>();
      for (const [id, cands] of (inner as Map<unknown, unknown>).entries()) {
        check(Number.isInteger(id) && Array.isArray(cands), 'objectIdIndex');
        out.set(
          id as number,
          (cands as unknown[]).map((c) => {
            check(
              isObj(c) &&
                typeof c.graphId === 'string' &&
                (c.encoding === 'sumOrd' || c.encoding === 'sha256'),
              'objectIdIndex',
            );
            return {
              graphId: c.graphId as string,
              encoding: c.encoding as ObjectIdCandidate['encoding'],
            };
          }),
        );
      }
      index.set(lmId, out);
    }
    return {
      fileName: m.fileName,
      byteLength: m.byteLength,
      lms,
      lmToLm: m.lmToLm,
      smToLm: m.smToLm,
      objectIdIndex: index,
    };
  } catch (err) {
    if (err instanceof ShapeError)
      throw new Error(`Invalid model data from loader: ${err.message}`);
    throw err;
  }
}
