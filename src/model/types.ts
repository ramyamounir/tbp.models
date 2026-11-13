/**
 * Typed, format-independent model structure produced by the Phase 2 loader (see spec
 * implementation-plan.md Phase 2 "Typed output"). Declared here in Phase 1 so the store
 * (src/state/store.ts) can type-check its graph-change reset rules.
 */

export interface ChannelGraph {
  channel: string; // 'patch_1' | 'learning_module_0'
  kind: 'sm' | 'lm';
  n: number;
  pos: Float64Array; // n*3, model frame, uncentered
  x: Float64Array; // n*F
  F: number;
  features: Record<string, [number, number]>; // feature_mapping, every range integer 0 <= start < end <= F
  nonFiniteRows: number; // rows of pos with a NaN/±Infinity coordinate (kept in pos; excluded from centroid/bounds)
}

/** On-disk position of a graph: file, lm_dict key, and index into graph_memory in pickle order. */
export interface GraphOrigin {
  fileId: string;
  lmId: number;
  entry: number;
}
/** Rewrite of object_id values in one LM channel of a graph ("Update references"). */
export interface ObjectIdPatch {
  channel: string;
  from: number;
  to: number;
}

export interface ObjectGraph {
  lmId: number;
  graphId: string;
  channels: ChannelGraph[];
  centroid: [number, number, number]; // centroid over finite pos rows only
  origin: GraphOrigin;
  patches: ObjectIdPatch[]; // [] unless references were rewritten
}

export interface UnreadableGraph {
  graphId: string; // keyLabel(key): display only, not necessarily unique
  reason: string;
  origin: GraphOrigin;
}

/**
 * One graph_memory entry of an LM, in list order. 'u' items are matched to `unreadable` by
 * origin (lmId + entry), never by label.
 */
export type OrderItem = { kind: 'r'; graphId: string } | { kind: 'u'; origin: GraphOrigin };

export interface LmEntry {
  lmId: number;
  graphIds: string[]; // readable graphs only, in the relative order of `order`
  graphs: Map<string, ObjectGraph>;
  unreadable: UnreadableGraph[]; // sorted by origin.entry at load
  /** undefined = created in the app (Add LM) or a gap. */
  origin?: { fileId: string; lmId: number };
  /**
   * All entries in graph_memory order. Invariant: the 'r' items are exactly `graphIds` in order,
   * the 'u' items are exactly `unreadable` (matched by origin.lmId + origin.entry) in order.
   */
  order: OrderItem[];
  gap?: true; // filled-in index with no lm_dict key on disk; origin is undefined
}

export interface ModelFile {
  fileName: string;
  byteLength: number;
  lms: LmEntry[]; // dense, sorted by lmId: lms[i].lmId === i (the store's lmId is this index)
  lmToLm: number[][];
  smToLm: number[][];
  objectIdIndex: ObjectIdIndex; // built in the worker by hash.ts buildObjectIdIndex(lms); read only via resolveObjectId
}

export type ObjectIdEncoding = 'sumOrd' | 'sha256';
export interface ObjectIdCandidate {
  graphId: string;
  encoding: ObjectIdEncoding;
}
// outer key = lmId of the LM that owns the graphs, inner key = encoded object_id
export type ObjectIdIndex = Map<number, Map<number, ObjectIdCandidate[]>>;
export type ObjectIdResolution =
  | {
      status: 'resolved';
      lmId: number;
      graphId: string;
      encoding: ObjectIdEncoding;
    }
  | { status: 'ambiguous'; lmId: number; candidates: ObjectIdCandidate[] } // >= 2 distinct graphIds, sorted by graphId
  | { status: 'unresolved'; id: number }; // raw (rounded if integral) id for display
