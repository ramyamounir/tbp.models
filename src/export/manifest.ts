/**
 * Export manifest (spec multi-file-edit-diff Phase 4b "Manifest"): what the exported file must
 * contain, built on the main thread from a file's edited view. The worker rebuilds the pickle
 * from it and verifies the result against `check`.
 */
import type { GraphOrigin, ObjectIdPatch } from '../model/types';
import type { SourceFile } from '../state/sourceFiles';
import type { OpenFile } from '../state/store';
import { ExportCancelledError } from './cancel';
import { ExportError } from './errors';

export interface ManifestGraph {
  /** Readable: graph id. Unreadable: UnreadableGraph.graphId (label, display / messages only). */
  name: string;
  origin: GraphOrigin;
  patches: ObjectIdPatch[];
  unreadable: boolean;
}

export interface ManifestLm {
  /** Shell to reuse; undefined = synthesise an empty LM. */
  origin?: { fileId: string; lmId: number };
  /** LmEntry.gap; with no graphs the LM is omitted from lm_dict. */
  gap?: true;
  /** One item per LmEntry.order item, in that order. */
  graphs: ManifestGraph[];
}

export interface ManifestCheck {
  lmId: number;
  graphId: string;
  channels: { channel: string; n: number; posHash: string; xHash: string }[];
}

export interface ExportManifest {
  dest: { fileId: string };
  /** Every fileId that appears in an origin, including dest; name = registry display name. */
  sources: Record<string, { file: File; name: string }>;
  lms: ManifestLm[];
  check: ManifestCheck[];
}

/**
 * Lowercase hex SHA-256 of exactly the bytes a typed array views, via `crypto.subtle.digest`.
 * Shared by buildManifest (main thread) and verifyExport (worker).
 */
export async function sha256Hex(a: ArrayBufferView): Promise<string> {
  const bytes = new Uint8Array(a.buffer as ArrayBuffer, a.byteOffset, a.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let s = '';
  for (const b of digest) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Builds the manifest of `file`'s current view. The synchronous part (sources, LM / graph lists,
 * LM-origin assertion) runs first, so its ExportErrors reject before any hashing starts; then the
 * graphs are hashed one channel at a time, reporting the client-side 'hashing' stage.
 */
export async function buildManifest(
  file: OpenFile,
  sourceFiles: Map<string, SourceFile>,
  onProgress?: (p: { stage: 'hashing'; pct?: number }) => void,
  signal?: AbortSignal,
): Promise<ExportManifest> {
  const view = file.view;
  const destId = file.id;
  const sources: ExportManifest['sources'] = {};
  let missing: string | undefined;
  const need = (fileId: string, what: string) => {
    if (Object.prototype.hasOwnProperty.call(sources, fileId)) return;
    const sf = sourceFiles.get(fileId);
    if (!sf) {
      missing ??= what;
      return;
    }
    sources[fileId] = { file: sf.file, name: sf.name };
  };
  need(destId, file.name);

  const lms: ManifestLm[] = [];
  for (const lm of view.lms) {
    if (lm.origin) {
      if (lm.origin.fileId !== destId)
        throw new ExportError('internal: LM origin from another file');
      need(lm.origin.fileId, file.name);
    }
    const unreadableBy = new Map<string, (typeof lm.unreadable)[number]>();
    for (const u of lm.unreadable) unreadableBy.set(`${u.origin.lmId}:${u.origin.entry}`, u);
    const graphs: ManifestGraph[] = [];
    for (const item of lm.order) {
      if (item.kind === 'r') {
        const g = lm.graphs.get(item.graphId);
        if (!g) throw new ExportError(`internal: graph ${item.graphId} missing from LM ${lm.lmId}`);
        need(g.origin.fileId, `The source file of ${item.graphId}`);
        graphs.push({
          name: item.graphId,
          origin: g.origin,
          patches: g.patches,
          unreadable: false,
        });
      } else {
        const u = unreadableBy.get(`${item.origin.lmId}:${item.origin.entry}`);
        if (!u) throw new ExportError(`internal: unreadable entry missing from LM ${lm.lmId}`);
        need(u.origin.fileId, `The source file of ${u.graphId}`);
        graphs.push({ name: u.graphId, origin: u.origin, patches: [], unreadable: true });
      }
    }
    const entry: ManifestLm = { graphs };
    if (lm.origin) entry.origin = { fileId: lm.origin.fileId, lmId: lm.origin.lmId };
    if (lm.gap) entry.gap = true;
    lms.push(entry);
  }
  if (missing !== undefined) {
    throw new ExportError(`${missing} is no longer available. Reopen it and repeat the copy.`);
  }

  // Hashes, graph by graph in manifest order, one channel at a time.
  const check: ManifestCheck[] = [];
  const total = view.lms.reduce((s, lm) => s + lm.graphIds.length, 0);
  let done = 0;
  if (total === 0) onProgress?.({ stage: 'hashing' });
  for (const lm of view.lms) {
    for (const item of lm.order) {
      if (item.kind !== 'r') continue;
      if (signal?.aborted) throw new ExportCancelledError();
      const g = lm.graphs.get(item.graphId)!;
      const channels: ManifestCheck['channels'] = [];
      for (const c of g.channels) {
        const posHash = await sha256Hex(c.pos);
        const xHash = await sha256Hex(c.x);
        channels.push({ channel: c.channel, n: c.n, posHash, xHash });
      }
      check.push({ lmId: lm.lmId, graphId: item.graphId, channels });
      done++;
      onProgress?.({ stage: 'hashing', pct: Math.round((100 * done) / total) });
    }
  }
  if (signal?.aborted) throw new ExportCancelledError();
  return { dest: { fileId: destId }, sources, lms, check };
}
