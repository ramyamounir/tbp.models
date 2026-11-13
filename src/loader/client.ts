/**
 * Main-thread loader client (spec Phase 2 "Client and cancellation", "Main-thread
 * validation"). One worker per load; a newer load or `cancel()` terminates the previous one,
 * and messages from stale generations are dropped.
 */
import type {
  ChannelGraph,
  GraphOrigin,
  LmEntry,
  ModelFile,
  ObjectGraph,
  ObjectIdCandidate,
  ObjectIdIndex,
  OrderItem,
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

/** A loader origin: `fileId` is '' (stamped on the main thread), `lmId` the owning LM. */
function validateOrigin(o: unknown, lmId: number, path: string): GraphOrigin {
  check(
    isObj(o) &&
      o.fileId === '' &&
      o.lmId === lmId &&
      typeof o.entry === 'number' &&
      Number.isSafeInteger(o.entry) &&
      o.entry >= 0,
    path,
  );
  return { fileId: '', lmId, entry: o.entry as number };
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
        check(Array.isArray(g.patches) && g.patches.length === 0, `${gp}.patches`);
        graphs.set(gid, {
          lmId: i,
          graphId: gid,
          channels,
          centroid: g.centroid as [number, number, number],
          origin: validateOrigin(g.origin, i, `${gp}.origin`),
          patches: [],
        });
      }
      const graphIds = (lm.graphIds as string[]).slice();
      check(
        graphIds.every((g) => graphs.has(g)) &&
          new Set(graphIds).size === graphIds.length &&
          graphIds.length === graphs.size,
        `${p}.graphIds`,
      );
      const unreadable: UnreadableGraph[] = (lm.unreadable as unknown[]).map((u) => {
        check(
          isObj(u) && typeof u.graphId === 'string' && typeof u.reason === 'string',
          `${p}.unreadable`,
        );
        return {
          graphId: u.graphId as string,
          reason: u.reason as string,
          origin: validateOrigin(u.origin, i, `${p}.unreadable.origin`),
        };
      });
      // order: 'r' items are exactly graphIds in order, 'u' items exactly unreadable in order
      // (matched by origin entry); every on-disk entry appears once.
      check(Array.isArray(lm.order), `${p}.order`);
      const order: OrderItem[] = [];
      let ri = 0;
      let ui = 0;
      const entries = new Set<number>();
      for (const it of lm.order as unknown[]) {
        check(isObj(it), `${p}.order`);
        if (it.kind === 'r') {
          check(it.graphId === graphIds[ri], `${p}.order`);
          entries.add(graphs.get(graphIds[ri])!.origin.entry);
          order.push({ kind: 'r', graphId: graphIds[ri++] });
        } else {
          check(it.kind === 'u' && ui < unreadable.length, `${p}.order`);
          const u = unreadable[ui++];
          const o = validateOrigin(it.origin, i, `${p}.order.origin`);
          check(o.entry === u.origin.entry, `${p}.order`);
          entries.add(o.entry);
          order.push({ kind: 'u', origin: u.origin });
        }
      }
      check(
        ri === graphIds.length &&
          ui === unreadable.length &&
          entries.size === graphIds.length + unreadable.length,
        `${p}.order`,
      );
      const gap = lm.gap;
      check(gap === undefined || gap === true, `${p}.gap`);
      let origin: LmEntry['origin'];
      if (gap) {
        check(lm.origin === undefined && order.length === 0, `${p}.gap`);
      } else {
        const o = lm.origin;
        check(isObj(o) && o.fileId === '' && o.lmId === i, `${p}.origin`);
        origin = { fileId: '', lmId: i };
      }
      const entry: LmEntry = { lmId: i, graphIds, graphs, unreadable, order };
      if (gap) entry.gap = true;
      else entry.origin = origin;
      return entry;
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

/**
 * Stamps the real file id on every origin of a freshly loaded model (graph and unreadable
 * origins, `LmEntry.origin` and the origin of every 'u' item of `order`). Returns a new model;
 * 'u' order items share their origin object with the matching unreadable entry.
 */
export function stampOrigin(model: ModelFile, fileId: string): ModelFile {
  const lms = model.lms.map((lm): LmEntry => {
    const graphs = new Map<string, ObjectGraph>();
    for (const [id, g] of lm.graphs) graphs.set(id, { ...g, origin: { ...g.origin, fileId } });
    const byEntry = new Map<number, GraphOrigin>();
    const unreadable = lm.unreadable.map((u) => {
      const origin = { ...u.origin, fileId };
      byEntry.set(origin.entry, origin);
      return { ...u, origin };
    });
    const order = lm.order.map((o): OrderItem =>
      o.kind === 'r'
        ? o
        : { kind: 'u', origin: byEntry.get(o.origin.entry) ?? { ...o.origin, fileId } },
    );
    const out: LmEntry = { ...lm, graphs, unreadable, order };
    if (lm.origin) out.origin = { ...lm.origin, fileId };
    return out;
  });
  return { ...model, lms };
}
