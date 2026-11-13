/**
 * Export pipeline (spec multi-file-edit-diff Phase 4b "Pipeline", "Zip parts assembly"): read the
 * source files, parse them into lossless trees, rebuild the destination tree from the manifest,
 * write the zip, then verify the result with the viewer's own loader.
 *
 * Stages 1-4 run inside `rebuildToBlob`, whose locals are the only holders of the trees, source
 * buffers and chunks, and which returns only the Blob, the warnings and the unexpected globals;
 * so everything but the Blob can be collected before `verifyExport` (stage 5) parses the output.
 */
import { ParseError } from '../loader/errors';
import { parseModelFile } from '../loader/parse';
import { openZip, type Zip } from '../loader/zip';
import {
  createStorageKeyAllocator,
  indexSource,
  rebuildDestination,
  type SourceIndex,
} from './astMonty';
import { forEachChild, strValue } from './astWalk';
import type { ExportResult, WorkerStage } from './client';
import { crc32 } from './crc32';
import { ExportError, ExportVerifyError } from './errors';
import { unexpectedGlobals } from './globals';
import { sha256Hex, type ExportManifest } from './manifest';
import { readPickleAst, type PickleAst, type PNode } from './pickleAst';
import { writePickle } from './pickleWrite';
import {
  checkArchivePrefix,
  droppedEntriesWarning,
  isStorageEntry,
  selectCopiedEntries,
  writeZip,
  type ZipPart,
} from './zipWrite';

export type BuildProgressFn = (p: { stage: WorkerStage; pct?: number }) => void;

interface Source {
  fileId: string;
  name: string;
  file: Blob;
  zip: Zip;
}

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs `f` and turns file-read and malformed-file errors into ExportErrors naming the file. */
async function guarded<T>(name: string, f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    if (err instanceof ExportError) throw err;
    const n = (err as { name?: unknown } | null)?.name;
    if (n === 'NotReadableError' || n === 'NotFoundError') {
      throw new ExportError(`${name} can no longer be read from disk. Reopen it and export again.`);
    }
    if (err instanceof ParseError)
      throw new ExportError(`${name} cannot be exported: ${err.message}`);
    throw err;
  }
}

/** Every storage key referenced by a persid in the tree, in first-reached order. */
function referencedStorageKeys(root: PNode): string[] {
  const keys = new Set<string>();
  const visited = new Set<PNode>([root]);
  const stack: PNode[] = [root];
  const visit = (c: PNode) => {
    if (!visited.has(c)) {
      visited.add(c);
      stack.push(c);
    }
  };
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.t === 'persid' && n.pid.t === 'tuple' && n.pid.items.length === 5) {
      const k = strValue(n.pid.items[2]);
      if (k !== undefined) keys.add(k);
    }
    forEachChild(n, visit);
  }
  return [...keys];
}

function missingStorage(name: string, key: string): ExportError {
  return new ExportError(
    `${name} references tensor storage ${key}, which is missing from the file; it cannot be exported`,
  );
}

/** Stages 1-4: returns only the Blob, the warnings and the unexpected globals. */
async function rebuildToBlob(
  manifest: ExportManifest,
  onProgress: BuildProgressFn,
): Promise<{ blob: Blob; warnings: string[]; unexpectedGlobals: string[] }> {
  const destId = manifest.dest.fileId;
  const ids = [destId, ...Object.keys(manifest.sources).filter((id) => id !== destId)];

  // 1. reading
  onProgress({ stage: 'reading', pct: 0 });
  const sources = new Map<string, Source>();
  const pkls = new Map<string, Uint8Array>();
  for (let k = 0; k < ids.length; k++) {
    const fileId = ids[k];
    const sf = manifest.sources[fileId];
    if (!sf) throw new ExportError('internal: destination missing from the manifest sources');
    const zip = await guarded(sf.name, () => openZip(sf.file));
    checkArchivePrefix(zip.prefix, sf.name);
    const pkl = await guarded(sf.name, () => zip.read(`${zip.prefix}/data.pkl`));
    sources.set(fileId, { fileId, name: sf.name, file: sf.file, zip });
    pkls.set(fileId, pkl);
    onProgress({ stage: 'reading', pct: Math.round((100 * (k + 1)) / ids.length) });
  }

  // 2. parsing
  onProgress({ stage: 'parsing', pct: 0 });
  const asts = new Map<string, PickleAst>();
  for (let k = 0; k < ids.length; k++) {
    const fileId = ids[k];
    const name = sources.get(fileId)!.name;
    try {
      asts.set(fileId, readPickleAst(pkls.get(fileId)!));
    } catch (err) {
      if (err instanceof ParseError)
        throw new ExportError(`${name} cannot be exported: ${err.message}`);
      throw err;
    }
    onProgress({ stage: 'parsing', pct: Math.round((100 * (k + 1)) / ids.length) });
  }

  // 3. rebuilding
  onProgress({ stage: 'rebuilding' });
  const indexes = new Map<string, SourceIndex>();
  for (const fileId of ids) {
    indexes.set(fileId, indexSource(fileId, sources.get(fileId)!.name, asts.get(fileId)!));
  }
  const dest = sources.get(destId)!;
  const prefix = dest.zip.prefix;
  const alloc = createStorageKeyAllocator(indexes.get(destId)!, dest.zip.order, prefix);
  const readStorage = async (fileId: string, key: string): Promise<Uint8Array> => {
    const s = sources.get(fileId);
    if (!s) throw new ExportError('internal: unknown storage source');
    const entry = `${s.zip.prefix}/data/${key}`;
    if (!s.zip.entries.has(entry)) throw missingStorage(s.name, key);
    return guarded(s.name, () => s.zip.read(entry));
  };
  const byteOrder = async (fileId: string): Promise<string | undefined> => {
    const s = sources.get(fileId);
    if (!s) return undefined;
    const entry = `${s.zip.prefix}/byteorder`;
    if (!s.zip.entries.has(entry)) return undefined;
    const bytes = await guarded(s.name, () => s.zip.read(entry));
    return new TextDecoder().decode(bytes).trim();
  };
  const rebuilt = await rebuildDestination({
    manifest,
    destAst: asts.get(destId)!,
    indexes,
    alloc,
    readStorage,
    byteOrder,
  });
  const globals = unexpectedGlobals(rebuilt.ast.root);
  const warnings = rebuilt.warnings.slice();

  // 4. writing
  onProgress({ stage: 'writing' });
  let chunks: Uint8Array[];
  try {
    chunks = writePickle(rebuilt.ast);
  } catch (err) {
    if (err instanceof ParseError)
      throw new ExportError(`${dest.name} cannot be exported: ${err.message}`);
    throw err;
  }
  let pklSize = 0;
  for (const c of chunks) pklSize += c.length;

  const copyPart = async (s: Source, entry: string, name: string): Promise<ZipPart> => {
    const ent = s.zip.entries.get(entry)!;
    const { start, end } = await guarded(s.name, () => s.zip.dataRange(entry));
    return {
      name,
      crc32: ent.crc32,
      size: ent.size,
      data: [s.file.slice(start, end)],
      copiedFrom: { sourceId: s.fileId, fileSize: s.file.size, entry, start, end },
    };
  };

  // Storages referenced by the final tree.
  const keptDest = new Set<string>();
  const newStorages: ZipPart[] = [];
  for (const key of referencedStorageKeys(rebuilt.ast.root)) {
    const name = `${prefix}/data/${key}`;
    const bytes = rebuilt.patched.get(key);
    if (bytes) {
      newStorages.push({ name, crc32: crc32([bytes]), size: bytes.length, data: [bytes] });
      continue;
    }
    const r = rebuilt.remap.get(key);
    if (r) {
      const s = sources.get(r.fileId);
      if (!s) throw new ExportError('internal: unknown storage source');
      const entry = `${s.zip.prefix}/data/${r.oldKey}`;
      if (!s.zip.entries.has(entry)) throw missingStorage(s.name, r.oldKey);
      newStorages.push(await copyPart(s, entry, name));
      continue;
    }
    if (!dest.zip.entries.has(name)) throw missingStorage(dest.name, key);
    keptDest.add(key);
  }

  const pklName = `${prefix}/data.pkl`;
  const { copy, dropped } = selectCopiedEntries(dest.zip.order, prefix);
  const copySet = new Set(copy);
  const parts: ZipPart[] = [];
  let insertAt = -1;
  for (const entry of dest.zip.order) {
    if (entry === pklName) {
      parts.push({ name: pklName, crc32: crc32(chunks), size: pklSize, data: chunks });
      if (insertAt < 0) insertAt = parts.length;
      continue;
    }
    if (isStorageEntry(entry, prefix)) {
      const key = entry.slice(`${prefix}/data/`.length);
      if (keptDest.has(key)) parts.push(await copyPart(dest, entry, entry));
      insertAt = parts.length;
      continue;
    }
    if (copySet.has(entry)) parts.push(await copyPart(dest, entry, entry));
  }
  if (insertAt < 0) insertAt = parts.length;
  parts.splice(insertAt, 0, ...newStorages);
  if (dropped > 0) warnings.push(droppedEntriesWarning(dropped));

  const blob = writeZip(parts);
  return { blob, warnings, unexpectedGlobals: globals };
}

/**
 * Stage 5: parses the exported Blob with the viewer's loader and compares it with the manifest,
 * one graph at a time (each graph's arrays are dropped once compared).
 */
export async function verifyExport(
  blob: Blob,
  name: string,
  manifest: ExportManifest,
): Promise<void> {
  const bad = (what: string) => new ExportVerifyError(`Export verification failed: ${what}`);
  let model;
  try {
    model = await parseModelFile(blob, name);
  } catch (err) {
    throw bad(`the exported file could not be read back (${errText(err)})`);
  }
  let expected = manifest.lms.length;
  while (expected > 0) {
    const last = manifest.lms[expected - 1];
    if (!(last.gap && last.graphs.length === 0)) break;
    expected--;
  }
  if (model.lms.length !== expected) {
    throw bad(`${model.lms.length} LMs written, expected ${expected}`);
  }
  let ci = 0;
  for (let i = 0; i < expected; i++) {
    const mlm = manifest.lms[i];
    const lm = model.lms[i];
    const names = mlm.graphs.filter((g) => !g.unreadable).map((g) => g.name);
    const unreadable = mlm.graphs.length - names.length;
    if (names.length !== lm.graphIds.length) {
      throw bad(`LM ${i} has ${lm.graphIds.length} readable models, expected ${names.length}`);
    }
    for (let k = 0; k < names.length; k++) {
      if (names[k] !== lm.graphIds[k]) {
        throw bad(`LM ${i} model ${k + 1} is "${lm.graphIds[k]}", expected "${names[k]}"`);
      }
    }
    if (lm.unreadable.length !== unreadable) {
      throw bad(`LM ${i} has ${lm.unreadable.length} unreadable entries, expected ${unreadable}`);
    }
    for (const id of lm.graphIds) {
      const chk = manifest.check[ci++];
      const g = lm.graphs.get(id);
      if (!chk || !g || chk.graphId !== id || chk.lmId !== i)
        throw bad(`LM ${i} model "${id}" is unexpected`);
      if (chk.channels.length !== g.channels.length) {
        throw bad(
          `LM ${i} model "${id}" has ${g.channels.length} channels, expected ${chk.channels.length}`,
        );
      }
      for (let c = 0; c < g.channels.length; c++) {
        const want = chk.channels[c];
        const got = g.channels[c];
        const where = `LM ${i} model "${id}" channel ${want.channel}`;
        if (got.channel !== want.channel) throw bad(`${where} is named ${got.channel}`);
        if (got.n !== want.n) throw bad(`${where} has ${got.n} nodes, expected ${want.n}`);
        if ((await sha256Hex(got.pos)) !== want.posHash) throw bad(`${where}: positions differ`);
        if ((await sha256Hex(got.x)) !== want.xHash) throw bad(`${where}: features differ`);
      }
      lm.graphs.delete(id); // drop this graph's arrays before the next one
    }
  }
  if (ci !== manifest.check.length) throw bad('fewer models than expected');
}

/** The full pipeline (stages 1-5). Runs in the export worker, or directly in a dev script. */
export async function buildExport(
  manifest: ExportManifest,
  fileName: string,
  onProgress: BuildProgressFn,
): Promise<ExportResult> {
  const { blob, warnings, unexpectedGlobals: globals } = await rebuildToBlob(manifest, onProgress);
  onProgress({ stage: 'verifying' });
  await verifyExport(blob, fileName, manifest);
  return { blob, warnings, unexpectedGlobals: globals };
}
