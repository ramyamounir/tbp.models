/**
 * Pure edit operations on a `ModelFile` view (spec multi-file-edit-diff, Phase 2 "Operations").
 *
 * Every op re-checks its arguments against the view it receives and returns `undefined` when
 * nothing is left to apply ("Stale arguments"). Otherwise it returns one `EditRecord` whose
 * `before` holds the input view's own references and whose `after` holds the new arrays. Input
 * views are never mutated: only the LMs an edit touches get new `LmEntry` objects / `Map`s, and
 * graphs share their typed arrays.
 */
import { buildObjectIdIndex, sha256_24, sumOrd } from '../model/hash';
import type {
  ChannelGraph,
  GraphOrigin,
  LmEntry,
  ModelFile,
  ObjectGraph,
  ObjectIdPatch,
  OrderItem,
} from '../model/types';
import { uniqueName, validateName } from './names';
import { descendantsOf, findReferrers, roundedObjectId, type Referrer } from './references';
import type { EditKind, EditRecord, GraphAddress, GraphMove, Snapshot } from './types';

type View = ModelFile;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function snapshotOf(view: View): Snapshot {
  return {
    lms: view.lms,
    lmToLm: view.lmToLm,
    smToLm: view.smToLm,
    objectIdIndex: view.objectIdIndex,
  };
}

/** Every graph id of an LM, readable and unreadable (names a new graph must not take). */
export function takenIds(lm: LmEntry): Set<string> {
  const s = new Set(lm.graphIds);
  for (const u of lm.unreadable) s.add(u.graphId);
  return s;
}

const sameOrigin = (a: GraphOrigin, b: GraphOrigin) =>
  a.fileId === b.fileId && a.lmId === b.lmId && a.entry === b.entry;

/** A new graph object at a new address; `origin` is kept, typed arrays are shared. */
function cloneGraph(g: ObjectGraph, lmId: number, graphId: string): ObjectGraph {
  return { ...g, lmId, graphId, patches: g.patches.slice() };
}

/** An empty LM created in the app (Add LM semantics): no origin, no gap. */
function emptyLm(lmId: number): LmEntry {
  return { lmId, graphIds: [], graphs: new Map(), unreadable: [], order: [] };
}

/** `m` with one appended row when it is non-empty (the view's matrices are display only). */
function appendRow(m: number[][], row: number[]): number[][] {
  return m.length > 0 ? [...m, row] : m;
}

async function record(
  view: View,
  kind: EditKind,
  text: { title: string; detail: string; note?: string },
  lms: LmEntry[],
  lmToLm: number[][],
  smToLm: number[][],
  identity: Pick<EditRecord, 'moves' | 'addedLms' | 'removedLm' | 'added'>,
): Promise<EditRecord> {
  const after: Snapshot = { lms, lmToLm, smToLm, objectIdIndex: await buildObjectIdIndex(lms) };
  const rec: EditRecord = {
    kind,
    title: text.title,
    detail: text.detail,
    before: snapshotOf(view),
    after,
  };
  if (text.note !== undefined) rec.note = text.note;
  if (identity.moves && identity.moves.length > 0) rec.moves = identity.moves;
  if (identity.addedLms && identity.addedLms.length > 0) rec.addedLms = identity.addedLms;
  if (identity.removedLm !== undefined) rec.removedLm = identity.removedLm;
  if (identity.added && identity.added.length > 0) rec.added = identity.added;
  return rec;
}

/**
 * Mutable copy of one LM used while an op builds its new view. `commit()` returns the new
 * `LmEntry`; the input LM is never touched.
 */
class LmDraft {
  graphIds: string[];
  graphs: Map<string, ObjectGraph>;
  order: OrderItem[];
  unreadable: LmEntry['unreadable'];
  taken: Set<string>;
  readonly base: LmEntry;
  constructor(base: LmEntry) {
    this.base = base;
    this.graphIds = base.graphIds.slice();
    this.graphs = new Map(base.graphs);
    this.order = base.order.slice();
    this.unreadable = base.unreadable;
    this.taken = takenIds(base);
  }
  /** Appends a readable graph at the end of graphIds and order. */
  append(g: ObjectGraph): void {
    this.graphIds.push(g.graphId);
    this.graphs.set(g.graphId, g);
    this.order.push({ kind: 'r', graphId: g.graphId });
    this.taken.add(g.graphId);
  }
  /** Replaces a graph object in place (same id). */
  replace(g: ObjectGraph): void {
    this.graphs.set(g.graphId, g);
  }
  commit(): LmEntry {
    // Rebuild the Map in graphIds order so iteration order matches the list.
    const graphs = new Map<string, ObjectGraph>();
    for (const id of this.graphIds) graphs.set(id, this.graphs.get(id)!);
    return {
      ...this.base,
      graphIds: this.graphIds,
      graphs,
      order: this.order,
      unreadable: this.unreadable,
    };
  }
}

/** Working set of LM drafts over a view's LMs; untouched LMs keep their object identity. */
class LmsDraft {
  private drafts = new Map<number, LmDraft>();
  private appended: LmEntry[] = [];
  private readonly base: LmEntry[];
  constructor(base: LmEntry[]) {
    this.base = base;
  }
  get length(): number {
    return this.base.length + this.appended.length;
  }
  lm(i: number): LmDraft {
    let d = this.drafts.get(i);
    if (!d) {
      const src = i < this.base.length ? this.base[i] : this.appended[i - this.base.length];
      d = new LmDraft(src);
      this.drafts.set(i, d);
    }
    return d;
  }
  /** True when LM `i` exists and has a graph (readable or unreadable) named `id`. */
  has(i: number, id: string): boolean {
    if (i >= this.length) return false;
    const d = this.drafts.get(i);
    if (d) return d.taken.has(id);
    const lm = i < this.base.length ? this.base[i] : this.appended[i - this.base.length];
    return lm.graphs.has(id) || lm.unreadable.some((u) => u.graphId === id);
  }
  /** Appends an empty LM (Add LM semantics) and returns its index. */
  appendEmpty(): number {
    const n = this.length;
    this.appended.push(emptyLm(n));
    return n;
  }
  commit(): LmEntry[] {
    const all = [...this.base, ...this.appended];
    return all.map((lm, i) => this.drafts.get(i)?.commit() ?? lm);
  }
}

// ---- rename ------------------------------------------------------------------------------

/** New object_id for `name` in the encoding a reference already uses. */
async function encodeId(name: string, enc: Referrer['encoding']): Promise<number> {
  return enc === 'sumOrd' ? sumOrd(name) : sha256_24(name);
}

/** `g` with object_id values rewritten per channel (`rewrites`: channel → from → to). */
function rewriteObjectIds(g: ObjectGraph, rewrites: Map<string, Map<number, number>>): ObjectGraph {
  const patches: ObjectIdPatch[] = g.patches.slice();
  const channels: ChannelGraph[] = g.channels.map((c) => {
    const map = rewrites.get(c.channel);
    if (!map || !Object.prototype.hasOwnProperty.call(c.features, 'object_id')) return c;
    const col = c.features.object_id[0];
    const x = c.x.slice();
    for (let i = 0; i < c.n; i++) {
      const k = i * c.F + col;
      const id = roundedObjectId(x[k]);
      if (id === undefined) continue;
      const to = map.get(id);
      if (to !== undefined) x[k] = to;
    }
    for (const [from, to] of map) patches.push({ channel: c.channel, from, to });
    return { ...c, x };
  });
  return { ...g, channels, patches };
}

/**
 * Renames graph `from` of LM `lmId` to `to`. With `rewriteReferences`, every resolved object_id
 * reference to it is re-encoded (same encoding as the reference) and recorded as a patch on the
 * referencing graph.
 */
export async function renameGraph(
  view: View,
  lmId: number,
  from: string,
  to: string,
  opts: { rewriteReferences: boolean },
): Promise<EditRecord | undefined> {
  const lm = view.lms[lmId];
  const g = lm?.graphs.get(from);
  if (!lm || !g) return undefined;
  if (validateName(to, takenIds(lm)) !== undefined) return undefined;

  const draft = new LmsDraft(view.lms);
  const d = draft.lm(lmId);
  const renamed = cloneGraph(g, lmId, to);
  d.graphIds = d.graphIds.map((id) => (id === from ? to : id));
  d.order = d.order.map((it) =>
    it.kind === 'r' && it.graphId === from ? { kind: 'r', graphId: to } : it,
  );
  d.graphs.delete(from);
  d.graphs.set(to, renamed);

  let note: string | undefined;
  if (opts.rewriteReferences) {
    const refs = findReferrers(view, lmId, from);
    // parent key → channel → from id → to id
    const byParent = new Map<
      string,
      { lmId: number; graphId: string; rewrites: Map<string, Map<number, number>> }
    >();
    for (const r of refs) {
      const newId = await encodeId(to, r.encoding);
      if (newId === r.id) continue; // e.g. a sumOrd anagram: the stored id already resolves
      const key = `${r.lmId}\u0000${r.graphId}`;
      let p = byParent.get(key);
      if (!p) byParent.set(key, (p = { lmId: r.lmId, graphId: r.graphId, rewrites: new Map() }));
      let ch = p.rewrites.get(r.channel);
      if (!ch) p.rewrites.set(r.channel, (ch = new Map()));
      ch.set(r.id, newId);
    }
    for (const p of byParent.values()) {
      // A self-reference rewrites the renamed graph itself.
      const parentId = p.lmId === lmId && p.graphId === from ? to : p.graphId;
      const pd = draft.lm(p.lmId);
      const parent = pd.graphs.get(parentId);
      if (parent) pd.replace(rewriteObjectIds(parent, p.rewrites));
    }
    if (byParent.size > 0) {
      const lmsOf = [...new Set([...byParent.values()].map((p) => p.lmId))].sort((a, b) => a - b);
      note = `LM ${lmsOf.join(', ')} · ${plural(byParent.size, 'graph')} with object_id references re-encoded`;
    }
  }

  const moves: GraphMove[] = [{ from: { lmId, graphId: from }, to: { lmId, graphId: to } }];
  return record(
    view,
    'rename',
    { title: 'Renamed', detail: `${from} → ${to}`, note },
    draft.commit(),
    view.lmToLm,
    view.smToLm,
    { moves },
  );
}

// ---- duplicate / delete --------------------------------------------------------------------

/** Duplicates readable graphs of one LM as `<name>_copy` (`_copy2`, …), appended in argument order. */
export async function duplicateGraphs(
  view: View,
  lmId: number,
  graphIds: string[],
): Promise<EditRecord | undefined> {
  const lm = view.lms[lmId];
  if (!lm) return undefined;
  const ids = [...new Set(graphIds)].filter((id) => lm.graphs.has(id));
  if (ids.length === 0) return undefined;
  const draft = new LmsDraft(view.lms);
  const d = draft.lm(lmId);
  const added: GraphAddress[] = [];
  const pairs: string[] = [];
  for (const id of ids) {
    const name = uniqueName(id, d.taken);
    d.append(cloneGraph(lm.graphs.get(id)!, lmId, name));
    added.push({ lmId, graphId: name });
    pairs.push(`${id} → ${name}`);
  }
  return record(
    view,
    'duplicate',
    {
      title: ids.length === 1 ? 'Duplicated' : `Duplicated ${ids.length} models`,
      detail: pairs.join(', '),
      note: `LM ${lmId}`,
    },
    draft.commit(),
    view.lmToLm,
    view.smToLm,
    { added },
  );
}

/** Removes readable graphs (by id) and unreadable entries (by origin) from one LM. */
export async function deleteGraphs(
  view: View,
  lmId: number,
  graphIds: string[],
  unreadable: GraphOrigin[] = [],
): Promise<EditRecord | undefined> {
  const lm = view.lms[lmId];
  if (!lm) return undefined;
  const ids = [...new Set(graphIds)].filter((id) => lm.graphs.has(id));
  const gone = lm.unreadable.filter((u) => unreadable.some((o) => sameOrigin(o, u.origin)));
  if (ids.length === 0 && gone.length === 0) return undefined;
  const idSet = new Set(ids);
  const goneSet = new Set(gone);
  const graphs = new Map<string, ObjectGraph>();
  for (const [id, g] of lm.graphs) if (!idSet.has(id)) graphs.set(id, g);
  const next: LmEntry = {
    ...lm,
    graphIds: lm.graphIds.filter((id) => !idSet.has(id)),
    graphs,
    unreadable: lm.unreadable.filter((u) => !goneSet.has(u)),
    order: lm.order.filter((it) =>
      it.kind === 'r' ? !idSet.has(it.graphId) : !gone.some((u) => sameOrigin(u.origin, it.origin)),
    ),
  };
  const lms = view.lms.slice();
  lms[lmId] = next;
  const moves: GraphMove[] = [
    ...ids.map((graphId) => ({ from: { lmId, graphId }, to: null })),
    ...gone.map((u) => ({ from: { lmId, graphId: u.graphId }, to: null })),
  ];
  const names = [...ids, ...gone.map((u) => u.graphId)];
  return record(
    view,
    'delete',
    {
      title: names.length === 1 ? 'Deleted' : `Deleted ${names.length} models`,
      detail: names.join(', '),
      note: `LM ${lmId}`,
    },
    lms,
    view.lmToLm,
    view.smToLm,
    { moves },
  );
}

// ---- copy --------------------------------------------------------------------------------

/**
 * Copies readable graphs of `src` into LM `destLmId` of `dest` (`destLmId === dest.lms.length`
 * creates that LM in the same record). Collisions get `_copy` suffixes. With `withChildren`,
 * every descendant missing (by name) from the LM with the same index in `dest` is copied too,
 * creating LMs as needed. `src` may be `dest` itself (same-file copy); items already in
 * `destLmId` are then skipped.
 */
export async function copyGraphs(
  dest: View,
  destLmId: number,
  src: View,
  items: { lmId: number; graphId: string }[],
  opts: { withChildren: boolean },
): Promise<EditRecord | undefined> {
  if (!Number.isInteger(destLmId) || destLmId < 0 || destLmId > dest.lms.length)
    throw new Error('copyGraphs: destLmId out of range');
  const sameFile = src === dest;
  const seen = new Set<string>();
  const selected: ObjectGraph[] = [];
  for (const it of items) {
    if (sameFile && it.lmId === destLmId) continue;
    const g = src.lms[it.lmId]?.graphs.get(it.graphId);
    const key = `${it.lmId}\u0000${it.graphId}`;
    if (!g || seen.has(key)) continue;
    seen.add(key);
    selected.push(g);
  }
  if (selected.length === 0) return undefined;

  const draft = new LmsDraft(dest.lms);
  const addedLms: number[] = [];
  let lmToLm = dest.lmToLm;
  let smToLm = dest.smToLm;
  const ensureLm = (i: number) => {
    while (draft.length <= i) {
      addedLms.push(draft.appendEmpty());
      lmToLm = appendRow(lmToLm, []);
      smToLm = appendRow(smToLm, []);
    }
  };
  const newDest = destLmId === dest.lms.length;
  ensureLm(destLmId);

  const added: GraphAddress[] = [];
  const target = draft.lm(destLmId);
  for (const g of selected) {
    const name = uniqueName(g.graphId, target.taken);
    target.append(cloneGraph(g, destLmId, name));
    added.push({ lmId: destLmId, graphId: name });
  }

  let children = 0;
  if (opts.withChildren) {
    for (const c of descendantsOf(src, selected)) {
      const g = src.lms[c.lmId]?.graphs.get(c.graphId);
      if (!g) continue;
      if (draft.has(c.lmId, c.graphId)) continue;
      ensureLm(c.lmId);
      const d = draft.lm(c.lmId);
      const name = uniqueName(c.graphId, d.taken);
      d.append(cloneGraph(g, c.lmId, name));
      added.push({ lmId: c.lmId, graphId: name });
      children++;
    }
  }

  const notes: string[] = [];
  if (children > 0) notes.push(`+${plural(children, 'child model')}`);
  if (newDest) notes.push(`new LM ${destLmId}`);
  return record(
    dest,
    'copy',
    {
      title: `Copied ${plural(selected.length, 'model')}`,
      detail: `LM ${selected[0].lmId} → LM ${destLmId}`,
      note: notes.length > 0 ? notes.join(' · ') : undefined,
    },
    draft.commit(),
    lmToLm,
    smToLm,
    { added, addedLms },
  );
}

// ---- learning modules ----------------------------------------------------------------------

/** Appends an empty LM with the next index. */
export async function addLm(view: View): Promise<EditRecord> {
  const n = view.lms.length;
  return record(
    view,
    'addLm',
    { title: 'Added LM', detail: `LM ${n}` },
    [...view.lms, emptyLm(n)],
    appendRow(view.lmToLm, []),
    appendRow(view.smToLm, []),
    { addedLms: [n] },
  );
}

/** Appends a copy of LM `lmId` with all its models (same names, same on-disk origins). */
export async function duplicateLm(view: View, lmId: number): Promise<EditRecord | undefined> {
  if (!Number.isInteger(lmId) || lmId < 0 || lmId >= view.lms.length) return undefined;
  const src = view.lms[lmId];
  const n = view.lms.length;
  const graphs = new Map<string, ObjectGraph>();
  for (const id of src.graphIds) graphs.set(id, cloneGraph(src.graphs.get(id)!, n, id));
  const copy: LmEntry = {
    lmId: n,
    graphIds: src.graphIds.slice(),
    graphs,
    unreadable: src.unreadable.slice(), // same objects: export reads the same on-disk entries
    order: src.order.slice(),
  };
  if (src.origin) copy.origin = src.origin; // a gap LM yields an ordinary empty LM
  const added = src.graphIds.map((graphId) => ({ lmId: n, graphId }));
  return record(
    view,
    'duplicateLm',
    {
      title: 'Duplicated LM',
      detail: `LM ${lmId} → LM ${n}`,
      note: plural(src.graphIds.length + src.unreadable.length, 'model'),
    },
    [...view.lms, copy],
    appendRow(view.lmToLm, (view.lmToLm[lmId] ?? []).slice()),
    appendRow(view.smToLm, (view.smToLm[lmId] ?? []).slice()),
    { addedLms: [n], added },
  );
}

/**
 * Removes LM `k`; later LMs are renumbered down by one (new LmEntry and graph objects, same
 * origin / order / unreadable / gap). Channel names inside graphs are not changed.
 */
export async function deleteLm(view: View, k: number): Promise<EditRecord | undefined> {
  if (!Number.isInteger(k) || k < 0 || k >= view.lms.length) return undefined;
  const removed = view.lms[k];
  const moves: GraphMove[] = [];
  for (const id of removed.graphIds) moves.push({ from: { lmId: k, graphId: id }, to: null });
  for (const u of removed.unreadable)
    moves.push({ from: { lmId: k, graphId: u.graphId }, to: null });
  const lms: LmEntry[] = view.lms.slice(0, k);
  for (let j = k + 1; j < view.lms.length; j++) {
    const lm = view.lms[j];
    const graphs = new Map<string, ObjectGraph>();
    for (const [id, g] of lm.graphs) {
      graphs.set(id, cloneGraph(g, j - 1, id));
      moves.push({ from: { lmId: j, graphId: id }, to: { lmId: j - 1, graphId: id } });
    }
    for (const u of lm.unreadable)
      moves.push({
        from: { lmId: j, graphId: u.graphId },
        to: { lmId: j - 1, graphId: u.graphId },
      });
    lms.push({ ...lm, lmId: j - 1, graphs });
  }
  const lmToLm =
    view.lmToLm.length === 0
      ? view.lmToLm
      : view.lmToLm
          .filter((_, i) => i !== k)
          .map((row) => row.filter((v) => v !== k).map((v) => (v > k ? v - 1 : v)));
  const smToLm = view.smToLm.length === 0 ? view.smToLm : view.smToLm.filter((_, i) => i !== k);
  const count = removed.graphIds.length + removed.unreadable.length;
  const later = view.lms.length - 1 - k;
  return record(
    view,
    'deleteLm',
    {
      title: 'Deleted LM',
      detail: `LM ${k}`,
      note:
        plural(count, 'model') + (later > 0 ? ` · ${plural(later, 'later LM')} renumbered` : ''),
    },
    lms,
    lmToLm,
    smToLm,
    { moves, removedLm: k },
  );
}
