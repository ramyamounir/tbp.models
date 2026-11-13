// Dev-only export spot check (spec Phases 4a "Round-trip script" and 4b "Dev spot check").
// Never imported by src/. Runs no pickle code.
// Usage:
//   npx tsx scripts/check_export.ts <in.pt> <out.pt> [edit flags…]
// Edit flags (applied in the order given, with the Phase 2 operations):
//   --rename lm:old:new        rename with "Update references" on
//   --rename-norefs lm:old:new rename with "Update references" off
//   --delete lm:name   --duplicate lm:name   --add-lm   --delete-lm k   --duplicate-lm k
//   --copy-from other.pt:lm:name:destLm   (destLm = "new" appends an LM)
// With no flags: reads <in.pt> into a lossless pickle tree, writes it back unedited, then parses
// both with the viewer's loader and compares LMs, graph order, node counts and array hashes.
// With flags: builds the edited view, its manifest, and runs the export pipeline (buildExport,
// which verifies the result with the viewer's loader) directly, without a worker.
import { createHash } from 'node:crypto';
import { createWriteStream, openAsBlob, realpathSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { parseModelFile } from '../src/loader/parse.ts';
import { stampOrigin } from '../src/loader/client.ts';
import { openZip } from '../src/loader/zip.ts';
import { crc32 } from '../src/export/crc32.ts';
import { ExportError } from '../src/export/errors.ts';
import { buildExport } from '../src/export/buildExport.ts';
import { unexpectedGlobals } from '../src/export/globals.ts';
import { buildManifest } from '../src/export/manifest.ts';
import { LazyBytes, readPickleAst, type PNode } from '../src/export/pickleAst.ts';
import { writePickle } from '../src/export/pickleWrite.ts';
import {
  checkArchivePrefix,
  droppedEntriesWarning,
  isStorageEntry,
  selectCopiedEntries,
  writeZip,
  type ZipPart,
} from '../src/export/zipWrite.ts';
import {
  addLm,
  copyGraphs,
  deleteGraphs,
  deleteLm,
  duplicateGraphs,
  duplicateLm,
  renameGraph,
} from '../src/edit/ops.ts';
import type { EditRecord } from '../src/edit/types.ts';
import type { ModelFile } from '../src/model/types.ts';
import type { SourceFile } from '../src/state/sourceFiles.ts';
import type { OpenFile } from '../src/state/store.ts';

const usage = () => {
  console.error(
    'usage: check_export.ts <in.pt> <out.pt> [--rename lm:old:new] [--rename-norefs lm:old:new] [--delete lm:name] [--duplicate lm:name] [--copy-from other.pt:lm:name:destLm] [--add-lm] [--delete-lm k] [--duplicate-lm k]',
  );
  process.exit(2);
};
const argv = process.argv.slice(2);
const [inPath, outPath] = argv;
if (!inPath || !outPath || inPath.startsWith('--') || outPath.startsWith('--')) usage();

type Flag = { flag: string; value?: string };
const flags: Flag[] = [];
const WITH_VALUE = new Set([
  '--rename',
  '--rename-norefs',
  '--delete',
  '--duplicate',
  '--copy-from',
  '--delete-lm',
  '--duplicate-lm',
]);
for (let k = 2; k < argv.length; k++) {
  const flag = argv[k];
  if (flag === '--add-lm') flags.push({ flag });
  else if (WITH_VALUE.has(flag)) {
    const value = argv[++k];
    if (value === undefined) usage();
    flags.push({ flag, value });
  } else usage();
}

/** `--copy-from other.pt:lm:name:destLm` → parts (the path may contain ':'). */
const copyFromParts = (v: string) => {
  const parts = v.split(':');
  if (parts.length < 4) usage();
  const destLm = parts.pop()!;
  const name = parts.pop()!;
  const lm = parts.pop()!;
  return { path: parts.join(':'), lm: Number(lm), name, destLm };
};
const copyPaths = flags
  .filter((f) => f.flag === '--copy-from')
  .map((f) => copyFromParts(f.value!).path);

const real = (p: string) => {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
};
if ([inPath, ...copyPaths].some((p) => real(p) === real(outPath))) {
  console.error('Output path equals an input path; refusing to overwrite an input');
  process.exit(2);
}

const bytesOf = (v: string | Uint8Array | LazyBytes): Uint8Array =>
  typeof v === 'string' ? new TextEncoder().encode(v) : v instanceof LazyBytes ? v.view : v;
const sameBytes = (x: Uint8Array, y: Uint8Array) =>
  x.length === y.length && Buffer.from(x.buffer, x.byteOffset, x.length).equals(y);

/**
 * Structural equality of two pickle trees, including object identity: shared and cyclic
 * nodes must map one to one (iterative, explicit stack).
 */
function astDiff(ra: PNode, rb: PNode): string | null {
  const fwd = new Map<PNode, PNode>();
  const back = new Map<PNode, PNode>();
  const stack: [PNode, PNode][] = [[ra, rb]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    if (a.t !== b.t) return `node type ${a.t} vs ${b.t}`;
    switch (a.t) {
      case 'none':
        continue;
      case 'bool':
      case 'int':
        if (a.v !== (b as typeof a).v) return `${a.t} ${a.v} vs ${(b as typeof a).v}`;
        continue;
      case 'float':
        if (!Object.is(a.v, (b as typeof a).v)) return `float ${a.v} vs ${(b as typeof a).v}`;
        continue;
      case 'long':
        if (!sameBytes(a.raw, (b as typeof a).raw)) return 'long differs';
        continue;
      default:
        break;
    }
    const fa = fwd.get(a);
    const fb = back.get(b);
    if (fa !== undefined || fb !== undefined) {
      if (fa !== b || fb !== a) return `object identity differs (${a.t})`;
      continue;
    }
    fwd.set(a, b);
    back.set(b, a);
    const pairs = (x: PNode[], y: PNode[], what: string): string | null => {
      if (x.length !== y.length) return `${what} length ${x.length} vs ${y.length}`;
      for (let k = x.length - 1; k >= 0; k--) stack.push([x[k], y[k]]);
      return null;
    };
    const flat = (kv: [PNode, PNode][] | undefined) => (kv ?? []).flat();
    let d: string | null = null;
    switch (a.t) {
      case 'str':
      case 'bstr':
      case 'bytes':
        if (!sameBytes(bytesOf(a.v), bytesOf((b as typeof a).v))) d = `${a.t} differs`;
        break;
      case 'global': {
        const g = b as typeof a;
        if (a.module !== g.module || a.name !== g.name) d = 'global differs';
        break;
      }
      case 'tuple':
      case 'list':
        d = pairs(a.items, (b as typeof a).items, a.t);
        break;
      case 'dict':
        d = pairs(a.items.flat(), (b as typeof a).items.flat(), 'dict');
        break;
      case 'persid':
        stack.push([a.pid, (b as typeof a).pid]);
        break;
      case 'obj': {
        const o = b as typeof a;
        if (a.via !== o.via) d = 'obj opcode differs';
        else if ((a.state === undefined) !== (o.state === undefined)) d = 'obj state differs';
        else {
          stack.push([a.fn, o.fn], [a.args, o.args]);
          if (a.state !== undefined) stack.push([a.state, o.state!]);
          d =
            pairs(a.listItems ?? [], o.listItems ?? [], 'obj listItems') ??
            pairs(flat(a.dictItems), flat(o.dictItems), 'obj dictItems');
        }
        break;
      }
    }
    if (d) return d;
  }
  return null;
}

async function roundTrip(): Promise<Blob> {
  const blob = await openAsBlob(inPath);
  const zip = await openZip(blob);
  checkArchivePrefix(zip.prefix, basename(inPath));
  const pklName = `${zip.prefix}/data.pkl`;
  const t0 = performance.now();
  const pkl = await zip.read(pklName);
  const ast = readPickleAst(pkl);
  const t1 = performance.now();
  const chunks = writePickle(ast);
  const t2 = performance.now();
  let size = 0;
  for (const c of chunks) size += c.length;
  console.log(
    `data.pkl: ${pkl.length} -> ${size} bytes (${pkl.length === size ? 'same size' : 'size differs'}); read ${Math.round(t1 - t0)} ms, write ${Math.round(t2 - t1)} ms`,
  );
  const { copy, dropped } = selectCopiedEntries(zip.order, zip.prefix);
  const copySet = new Set(copy);
  const parts: ZipPart[] = [];
  for (const name of zip.order) {
    if (name === pklName) {
      parts.push({ name, crc32: crc32(chunks), size, data: chunks });
      continue;
    }
    if (!isStorageEntry(name, zip.prefix) && !copySet.has(name)) continue;
    const ent = zip.entries.get(name)!;
    const { start, end } = await zip.dataRange(name);
    parts.push({
      name,
      crc32: ent.crc32,
      size: ent.size,
      data: [blob.slice(start, end)],
      copiedFrom: { sourceId: inPath, fileSize: blob.size, entry: name, start, end },
    });
  }
  if (dropped > 0) console.log(`warning: ${droppedEntriesWarning(dropped)}`);
  printGlobals(unexpectedGlobals(ast.root));
  const out = writeZip(parts);
  // Re-read the written data.pkl symbolically and compare the trees (values and identity).
  const outZip = await openZip(out);
  const back = readPickleAst(await outZip.read(`${outZip.prefix}/data.pkl`));
  const d = astDiff(ast.root, back.root);
  console.log(d ? `pickle tree MISMATCH: ${d}` : 'pickle tree identical (values and sharing)');
  if (d) process.exit(1);
  return out;
}

const sha = (a: Float64Array) =>
  createHash('sha256')
    .update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
    .digest('hex');

function compare(a: ModelFile, b: ModelFile): string | null {
  if (a.lms.length !== b.lms.length) return `LM count ${a.lms.length} vs ${b.lms.length}`;
  for (let i = 0; i < a.lms.length; i++) {
    const la = a.lms[i];
    const lb = b.lms[i];
    if (!!la.gap !== !!lb.gap) return `LM ${i}: gap ${!!la.gap} vs ${!!lb.gap}`;
    if (la.order.length !== lb.order.length) {
      return `LM ${i}: ${la.order.length} vs ${lb.order.length} graph_memory entries`;
    }
    const labelA = new Map(la.unreadable.map((u) => [u.origin.entry, u.graphId]));
    const labelB = new Map(lb.unreadable.map((u) => [u.origin.entry, u.graphId]));
    for (let k = 0; k < la.order.length; k++) {
      const oa = la.order[k];
      const ob = lb.order[k];
      if (oa.kind !== ob.kind) return `LM ${i} entry ${k}: kind ${oa.kind} vs ${ob.kind}`;
      if (oa.kind === 'r' && ob.kind === 'r') {
        if (oa.graphId !== ob.graphId) return `LM ${i} entry ${k}: ${oa.graphId} vs ${ob.graphId}`;
      } else if (oa.kind === 'u' && ob.kind === 'u') {
        if (oa.origin.entry !== ob.origin.entry)
          return `LM ${i} entry ${k}: unreadable entry ${oa.origin.entry} vs ${ob.origin.entry}`;
        const xa = labelA.get(oa.origin.entry);
        const xb = labelB.get(ob.origin.entry);
        if (xa !== xb) return `LM ${i} entry ${k}: unreadable label ${xa} vs ${xb}`;
      }
    }
    for (const id of la.graphIds) {
      const ga = la.graphs.get(id)!;
      const gb = lb.graphs.get(id);
      if (!gb) return `LM ${i} graph ${id} missing`;
      if (ga.channels.length !== gb.channels.length)
        return `LM ${i} graph ${id}: channel count differs`;
      for (let c = 0; c < ga.channels.length; c++) {
        const ca = ga.channels[c];
        const cb = gb.channels[c];
        const where = `LM ${i} graph ${id} channel ${ca.channel}`;
        if (ca.channel !== cb.channel) return `${where}: name ${cb.channel}`;
        if (ca.n !== cb.n) return `${where}: ${ca.n} vs ${cb.n} nodes`;
        if (sha(ca.pos) !== sha(cb.pos)) return `${where}: pos differs`;
        if (sha(ca.x) !== sha(cb.x)) return `${where}: x differs`;
      }
    }
  }
  return null;
}

async function writeOut(blob: Blob): Promise<void> {
  await pipeline(
    Readable.fromWeb(blob.stream() as unknown as NodeReadableStream),
    createWriteStream(outPath, { flags: 'wx' }),
  );
  console.log(`wrote ${outPath} (${blob.size} bytes)`);
}

function printGlobals(list: string[]): void {
  if (list.length === 0) console.log('no unexpected globals');
  else for (const g of list) console.log(`unexpected global: ${g}`);
}

async function roundTripMode(): Promise<void> {
  try {
    const out = await roundTrip();
    await writeOut(out);
  } catch (err) {
    if (err instanceof ExportError) {
      console.error(`export failed: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  const a = await parseModelFile(await openAsBlob(inPath), basename(inPath));
  const b = await parseModelFile(await openAsBlob(outPath), basename(outPath));
  const diff = compare(a, b);
  if (diff) {
    console.log(`MISMATCH: ${diff}`);
    process.exit(1);
  }
  const graphs = a.lms.reduce((s, lm) => s + lm.graphIds.length, 0);
  console.log(`OK (${a.lms.length} LMs, ${graphs} graphs)`);
}

async function editMode(): Promise<void> {
  const sourceFiles = new Map<string, SourceFile>();
  const views = new Map<string, ModelFile>(); // by real path
  const ids = new Map<string, string>(); // real path -> file id
  const open = async (path: string): Promise<{ id: string; view: ModelFile }> => {
    const key = real(path);
    const known = ids.get(key);
    if (known) return { id: known, view: views.get(key)! };
    const id = ids.size === 0 ? 'in' : `src${ids.size}`;
    const blob = await openAsBlob(path);
    // The pipeline only uses Blob methods; a Blob stands in for the browser's File handle.
    const file = blob as unknown as File;
    const name = ids.size === 0 ? basename(path) : `${basename(path)} (${id})`;
    const view = stampOrigin(await parseModelFile(blob, name), id);
    ids.set(key, id);
    views.set(key, view);
    sourceFiles.set(id, { file, name });
    return { id, view };
  };
  const dest = await open(inPath);
  let view = dest.view;
  const apply = (what: string, rec: EditRecord | undefined) => {
    if (!rec) {
      console.error(`edit not applicable: ${what}`);
      process.exit(1);
    }
    view = { ...view, ...rec.after };
    console.log(`edit: ${rec.title} ${rec.detail}${rec.note ? ` (${rec.note})` : ''}`);
  };
  for (const { flag, value } of flags) {
    const what = `${flag} ${value ?? ''}`.trim();
    const parts = value?.split(':') ?? [];
    switch (flag) {
      case '--rename':
      case '--rename-norefs': {
        if (parts.length !== 3) usage();
        apply(
          what,
          await renameGraph(view, Number(parts[0]), parts[1], parts[2], {
            rewriteReferences: flag === '--rename',
          }),
        );
        break;
      }
      case '--delete': {
        const [lm, ...rest] = parts;
        apply(what, await deleteGraphs(view, Number(lm), [rest.join(':')]));
        break;
      }
      case '--duplicate': {
        const [lm, ...rest] = parts;
        apply(what, await duplicateGraphs(view, Number(lm), [rest.join(':')]));
        break;
      }
      case '--add-lm':
        apply(what, await addLm(view));
        break;
      case '--delete-lm':
        apply(what, await deleteLm(view, Number(value)));
        break;
      case '--duplicate-lm':
        apply(what, await duplicateLm(view, Number(value)));
        break;
      case '--copy-from': {
        const c = copyFromParts(value!);
        const src = real(c.path) === real(inPath) ? { view } : await open(c.path);
        const destLm = c.destLm === 'new' ? view.lms.length : Number(c.destLm);
        apply(
          what,
          await copyGraphs(view, destLm, src.view, [{ lmId: c.lm, graphId: c.name }], {
            withChildren: false,
          }),
        );
        break;
      }
    }
  }
  const openFile = {
    id: dest.id,
    file: sourceFiles.get(dest.id)!.file,
    name: sourceFiles.get(dest.id)!.name,
    byteLength: view.byteLength,
    view,
    nav: { lmId: 0 },
    undo: [],
    redo: [],
    savedDepth: 0,
  } satisfies OpenFile;
  const t0 = performance.now();
  try {
    const manifest = await buildManifest(openFile, sourceFiles);
    const result = await buildExport(manifest, basename(outPath), (p) =>
      console.log(`  ${p.stage}${p.pct !== undefined ? ` ${p.pct}%` : ''}`),
    );
    for (const w of result.warnings) console.log(`warning: ${w}`);
    printGlobals(result.unexpectedGlobals);
    await writeOut(result.blob);
  } catch (err) {
    if (err instanceof ExportError) {
      console.error(`export failed: ${err.message}`);
      process.exit(1);
    }
    throw err;
  }
  console.log(`OK, verified (${Math.round(performance.now() - t0)} ms)`);
}

if (flags.length === 0) await roundTripMode();
else await editMode();
