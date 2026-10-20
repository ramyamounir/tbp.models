// Dev-only spot check (spec Phase 2 "Spot-check scripts"). Never imported by src/.
// Usage:
//   npx tsx scripts/check_loader.ts <model.pt> <lm> <graph>  > ts.json   # normalized per-channel JSON
//   npx tsx scripts/check_loader.ts <model.pt>                           # one-line summary (sweep mode)
import { openAsBlob } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';
import { parseModelFile } from '../src/loader/parse.ts';

const [path, lmArg, graphId] = process.argv.slice(2);
if (!path) {
  console.error('usage: check_loader.ts <model.pt> [<lm> <graph>]');
  process.exit(2);
}

if (lmArg === undefined) {
  const t0 = performance.now();
  try {
    const blob = await openAsBlob(path);
    const model = await parseModelFile(blob, basename(path));
    const ms = Math.round(performance.now() - t0);
    const graphs = model.lms.reduce((s, lm) => s + lm.graphIds.length, 0);
    const unreadable = model.lms.reduce((s, lm) => s + lm.unreadable.length, 0);
    console.log(
      `${path}\tLMs=${model.lms.length}\tgraphs=${graphs}\tunreadable=${unreadable}\t${ms} ms`,
    );
    for (const lm of model.lms)
      for (const u of lm.unreadable) console.log(`  LM ${lm.lmId} ${u.graphId}: ${u.reason}`);
    process.exit(0);
  } catch (err) {
    console.log(
      `${path}\tERROR\t${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    process.exit(1);
  }
}

const blob = await openAsBlob(path); // lazy, file-backed Blob (no full read)
const model = await parseModelFile(blob, basename(path));
const lm = Number(lmArg);
const graph = model.lms[lm]?.graphs.get(graphId);
if (!graph) {
  console.error(`no graph ${graphId} in LM ${lm}`);
  process.exit(2);
}
const num = (v: number) => (Number.isFinite(v) ? v : String(v)); // 'NaN' | 'Infinity' | '-Infinity'
const sha = (a: Float64Array) => {
  // host must be little-endian (x86/ARM)
  if (new Uint8Array(new Float64Array([1]).buffer)[7] !== 0x3f) throw new Error('big-endian host');
  return createHash('sha256')
    .update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength))
    .digest('hex');
};
const channels: Record<string, unknown> = {};
for (const ch of [...graph.channels].sort((a, b) =>
  a.channel < b.channel ? -1 : a.channel > b.channel ? 1 : 0,
)) {
  const { n, F } = ch;
  const features = Object.fromEntries(
    Object.entries(ch.features).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  channels[ch.channel] = {
    n,
    F,
    features,
    nonFiniteRows: ch.nonFiniteRows,
    posSha256: sha(ch.pos),
    xSha256: sha(ch.x),
    rows: (n === 0 ? [] : [0, Math.floor(n / 2), n - 1]).map((i) => ({
      i,
      pos: [...ch.pos.subarray(3 * i, 3 * i + 3)].map(num),
      x: [...ch.x.subarray(F * i, F * i + F)].map(num),
    })),
  };
}
console.log(JSON.stringify({ model: basename(path), lm, graph: graphId, channels }, null, 1));
