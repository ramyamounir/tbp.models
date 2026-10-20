/**
 * Test-only builders for minimal model.pt files: a tiny protocol-2 pickle writer and a STORED
 * zip writer (spec Phase 2 "Malformed-input tests"). Not imported by app code.
 */

const te = new TextEncoder();

/** Emits protocol-2 pickle opcodes. */
export class PickleWriter {
  private out: number[] = [];

  raw(...bytes: number[]): this {
    for (const b of bytes) this.out.push(b & 0xff);
    return this;
  }
  rawBytes(b: Uint8Array): this {
    for (const x of b) this.out.push(x);
    return this;
  }
  private u32(n: number): this {
    return this.raw(n, n >>> 8, n >>> 16, n >>> 24);
  }
  proto(): this {
    return this.raw(0x80, 2);
  }
  stop(): this {
    return this.raw(0x2e);
  }
  mark(): this {
    return this.raw(0x28);
  }
  none(): this {
    return this.raw(0x4e);
  }
  bool(v: boolean): this {
    return this.raw(v ? 0x88 : 0x89);
  }
  int(n: number): this {
    if (Number.isInteger(n) && n >= 0 && n < 256) return this.raw(0x4b, n);
    if (Number.isInteger(n) && n >= 0 && n < 65536) return this.raw(0x4d, n, n >>> 8);
    if (Number.isInteger(n) && n >= -(2 ** 31) && n < 2 ** 31) return this.raw(0x4a).u32(n >>> 0);
    // LONG1, 8 bytes two's complement
    let v = BigInt(n);
    if (v < 0n) v += 1n << 64n;
    const bytes: number[] = [];
    for (let k = 0; k < 8; k++) bytes.push(Number((v >> BigInt(8 * k)) & 0xffn));
    return this.raw(0x8a, 8, ...bytes);
  }
  float(v: number): this {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setFloat64(0, v, false);
    return this.raw(0x47, ...b);
  }
  /** BINUNICODE (always the 4-byte-length form). */
  str(s: string): this {
    return this.unicodeBytes(te.encode(s));
  }
  unicodeBytes(b: Uint8Array): this {
    this.raw(0x58).u32(b.length);
    for (const x of b) this.out.push(x);
    return this;
  }
  emptyDict(): this {
    return this.raw(0x7d);
  }
  emptyList(): this {
    return this.raw(0x5d);
  }
  emptyTuple(): this {
    return this.raw(0x29);
  }
  tuple(): this {
    return this.raw(0x74);
  }
  setitem(): this {
    return this.raw(0x73);
  }
  setitems(): this {
    return this.raw(0x75);
  }
  append(): this {
    return this.raw(0x61);
  }
  appends(): this {
    return this.raw(0x65);
  }
  global(module: string, name: string): this {
    this.raw(0x63);
    for (const b of te.encode(`${module}\n${name}\n`)) this.out.push(b);
    return this;
  }
  reduce(): this {
    return this.raw(0x52);
  }
  newobj(): this {
    return this.raw(0x81);
  }
  build(): this {
    return this.raw(0x62);
  }
  binpersid(): this {
    return this.raw(0x51);
  }
  binput(k: number): this {
    return this.raw(0x71, k);
  }
  binget(k: number): this {
    return this.raw(0x68, k);
  }
  /** Writes `items` (callbacks) as a MARK ... TUPLE tuple. */
  tupleOf(...items: ((w: PickleWriter) => void)[]): this {
    this.mark();
    for (const it of items) it(this);
    return this.tuple();
  }
  intTuple(v: readonly number[]): this {
    return this.tupleOf(...v.map((n) => (w: PickleWriter) => void w.int(n)));
  }
  /** `{k: v, ...}` from callbacks. */
  dictOf(entries: [string | number, (w: PickleWriter) => void][]): this {
    this.emptyDict();
    if (entries.length === 0) return this;
    this.mark();
    for (const [k, v] of entries) {
      if (typeof k === 'string') this.str(k);
      else this.int(k);
      v(this);
    }
    return this.setitems();
  }
  /** `cls()` via NEWOBJ then BUILD with a dict state. */
  object(module: string, name: string, state: [string, (w: PickleWriter) => void][]): this {
    this.global(module, name).emptyTuple().newobj();
    this.dictOf(state);
    return this.build();
  }
  /** `_codecs.encode(<latin-1 text of bytes>, 'latin1')`, as Python 3 pickles `bytes` with protocol 2. */
  pyBytes(bytes: Uint8Array): this {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    this.global('_codecs', 'encode');
    this.mark().str(s).str('latin1').tuple();
    return this.reduce();
  }
  /** numpy array via `_reconstruct` + BUILD (payload written by `payload`). */
  numpyArray(shape: readonly number[], dtype: string, payload: (w: PickleWriter) => void): this {
    this.global('numpy.core.multiarray', '_reconstruct');
    this.mark()
      .global('numpy', 'ndarray')
      .intTuple([0])
      .pyBytes(new Uint8Array([0x62]))
      .tuple()
      .reduce();
    this.mark().int(1).intTuple(shape);
    this.global('numpy', 'dtype').mark().str(dtype).bool(false).bool(true).tuple().reduce();
    this.mark().int(3).str('<').none().none().none().int(-1).int(-1).int(0).tuple().build();
    this.bool(false);
    payload(this);
    this.tuple();
    return this.build();
  }
  /** `torch._utils._rebuild_tensor_v2(storage, offset, size, stride, False, OrderedDict())`. */
  tensor(t: TensorSpec): this {
    this.global('torch._utils', '_rebuild_tensor_v2');
    this.mark();
    this.mark()
      .str('storage')
      .global('torch', t.storageClass ?? 'DoubleStorage')
      .str(t.key)
      .str('cpu')
      .int(t.numel)
      .tuple();
    this.binpersid();
    this.int(t.offset ?? 0)
      .intTuple(t.size)
      .intTuple(t.stride);
    this.bool(false).global('collections', 'OrderedDict').emptyTuple().reduce();
    this.tuple();
    return this.reduce();
  }
  bytes(): Uint8Array {
    return new Uint8Array(this.out);
  }
}

export interface TensorSpec {
  key: string;
  numel: number;
  size: readonly number[];
  stride: readonly number[];
  offset?: number;
  storageClass?: string;
}

export interface ZipFile {
  name: string;
  data: Uint8Array;
  method?: number;
}

export interface ZipOptions {
  zip64?: boolean;
  /** Override the zip64 locator / EOCD64 signatures (malformed tests). */
  zip64LocatorSig?: number;
  zip64EocdSig?: number;
}

/** STORED zip writer (local headers, central directory, EOCD; optional zip64 records). */
export function buildZip(files: ZipFile[], opts: ZipOptions = {}): Uint8Array {
  const chunks: Uint8Array[] = [];
  let offset = 0;
  const central: Uint8Array[] = [];
  for (const f of files) {
    const name = te.encode(f.name);
    const lh = new Uint8Array(30 + name.length);
    const l = new DataView(lh.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(8, f.method ?? 0, true);
    l.setUint32(18, f.data.length, true);
    l.setUint32(22, f.data.length, true);
    l.setUint16(26, name.length, true);
    lh.set(name, 30);
    const localOffset = offset;
    chunks.push(lh, f.data);
    offset += lh.length + f.data.length;

    const extra = opts.zip64 ? 4 + 24 : 0;
    const ch = new Uint8Array(46 + name.length + extra);
    const c = new DataView(ch.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 45, true);
    c.setUint16(6, 20, true);
    c.setUint16(10, f.method ?? 0, true);
    c.setUint32(20, opts.zip64 ? 0xffffffff : f.data.length, true);
    c.setUint32(24, opts.zip64 ? 0xffffffff : f.data.length, true);
    c.setUint16(28, name.length, true);
    c.setUint16(30, extra, true);
    c.setUint32(42, opts.zip64 ? 0xffffffff : localOffset, true);
    ch.set(name, 46);
    if (opts.zip64) {
      const e = 46 + name.length;
      c.setUint16(e, 1, true);
      c.setUint16(e + 2, 24, true);
      c.setBigUint64(e + 4, BigInt(f.data.length), true);
      c.setBigUint64(e + 12, BigInt(f.data.length), true);
      c.setBigUint64(e + 20, BigInt(localOffset), true);
    }
    central.push(ch);
  }
  const cdOffset = offset;
  let cdSize = 0;
  for (const ch of central) {
    chunks.push(ch);
    cdSize += ch.length;
  }
  offset += cdSize;
  if (opts.zip64) {
    const z = new Uint8Array(56);
    const zd = new DataView(z.buffer);
    zd.setUint32(0, opts.zip64EocdSig ?? 0x06064b50, true);
    zd.setBigUint64(4, 44n, true);
    zd.setUint16(12, 45, true);
    zd.setUint16(14, 45, true);
    zd.setBigUint64(24, BigInt(files.length), true);
    zd.setBigUint64(32, BigInt(files.length), true);
    zd.setBigUint64(40, BigInt(cdSize), true);
    zd.setBigUint64(48, BigInt(cdOffset), true);
    const zOffset = offset;
    chunks.push(z);
    offset += 56;
    const loc = new Uint8Array(20);
    const ld = new DataView(loc.buffer);
    ld.setUint32(0, opts.zip64LocatorSig ?? 0x07064b50, true);
    ld.setBigUint64(8, BigInt(zOffset), true);
    ld.setUint32(16, 1, true);
    chunks.push(loc);
    offset += 20;
  }
  const eocd = new Uint8Array(22);
  const ed = new DataView(eocd.buffer);
  ed.setUint32(0, 0x06054b50, true);
  ed.setUint16(8, opts.zip64 ? 0xffff : files.length, true);
  ed.setUint16(10, opts.zip64 ? 0xffff : files.length, true);
  ed.setUint32(12, opts.zip64 ? 0xffffffff : cdSize, true);
  ed.setUint32(16, opts.zip64 ? 0xffffffff : cdOffset, true);
  chunks.push(eocd);
  const out = new Uint8Array(offset + 22);
  let p = 0;
  for (const ch of chunks) {
    out.set(ch, p);
    p += ch.length;
  }
  return out;
}

/** Patch fields of the (non-zip64) EOCD at the end of a zip. */
export function patchEocd(
  zip: Uint8Array,
  fields: { cdOffset?: number; cdSize?: number; count?: number },
): Uint8Array {
  const out = zip.slice();
  const d = new DataView(out.buffer);
  const e = out.length - 22;
  if (fields.count !== undefined) {
    d.setUint16(e + 8, fields.count, true);
    d.setUint16(e + 10, fields.count, true);
  }
  if (fields.cdSize !== undefined) d.setUint32(e + 12, fields.cdSize, true);
  if (fields.cdOffset !== undefined) d.setUint32(e + 16, fields.cdOffset, true);
  return out;
}

export const FIXTURE_N = 4;
export const FIXTURE_F = 11;

/** Deterministic fixture values: pos[r] = (r, 2r, 3r) + 0.5, x[r, c] = r * 100 + c. */
export function fixturePos(n = FIXTURE_N): Float64Array {
  const a = new Float64Array(n * 3);
  for (let r = 0; r < n; r++) for (let c = 0; c < 3; c++) a[3 * r + c] = r * (c + 1) + 0.5;
  return a;
}
export function fixtureX(n = FIXTURE_N, F = FIXTURE_F): Float64Array {
  const a = new Float64Array(n * F);
  for (let r = 0; r < n; r++) for (let c = 0; c < F; c++) a[F * r + c] = r * 100 + c;
  return a;
}

const DEFAULT_FM: Record<string, [number, number]> = {
  pose_vectors: [0, 9],
  pose_fully_defined: [9, 10],
  on_object: [10, 11],
};

export interface ModelPtOverrides {
  /** Replace the whole pickle. */
  pickle?: Uint8Array;
  graphId?: string;
  /** Channel name (default `patch`). */
  channel?: string;
  /** Overrides for the `pos` tensor and its storage. */
  pos?: Partial<TensorSpec> & { bytes?: Uint8Array };
  featureMapping?: Record<string, [number, number]>;
  /** 'tensor' (default, torch storages) or 'numpy' (inline numpy arrays, GridObjectModel style). */
  arrays?: 'tensor' | 'numpy';
  /** Legacy GraphObjectModel: torch_geometric Data with a leading node_ids column in x. */
  legacy?: boolean;
  /** Extra root entries written after lm_dict (e.g. a large `sm_dict`). */
  extraRoot?: [string, (w: PickleWriter) => void][];
  prefix?: string;
  /** Post-process the zip file list (rename entries, set method, duplicate, ...). */
  files?: (files: ZipFile[]) => ZipFile[];
  zip?: ZipOptions;
}

const f64Bytes = (a: Float64Array) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/** A minimal valid Monty model.pt (1 LM, 1 graph, 1 channel, 4 nodes, F = 11). */
export function buildModelPt(o: ModelPtOverrides = {}): Uint8Array {
  const prefix = o.prefix ?? 'model';
  const graphId = o.graphId ?? 'g';
  const channel = o.channel ?? 'patch';
  const n = FIXTURE_N;
  const pos = fixturePos(n);
  let F = FIXTURE_F;
  let x = fixtureX(n, F);
  let fm: Record<string, [number, number]> = o.featureMapping ?? DEFAULT_FM;
  if (o.legacy) {
    // Prepend a node_ids column and shift the mapping, as GraphObjectModel stores it.
    const F2 = F + 1;
    const x2 = new Float64Array(n * F2);
    for (let r = 0; r < n; r++) {
      x2[F2 * r] = r;
      x2.set(x.subarray(F * r, F * r + F), F2 * r + 1);
    }
    x = x2;
    F = F2;
    fm = {
      node_ids: [0, 1],
      ...Object.fromEntries(Object.entries(fm).map(([k, [s, e]]) => [k, [s + 1, e + 1]])),
    };
  }
  const files: ZipFile[] = [];
  let pickle = o.pickle;
  if (!pickle) {
    const posSpec: TensorSpec = {
      key: '0',
      numel: o.pos?.numel ?? n * 3,
      size: o.pos?.size ?? [n, 3],
      stride: o.pos?.stride ?? [3, 1],
      offset: o.pos?.offset ?? 0,
      storageClass: o.pos?.storageClass,
    };
    const xSpec: TensorSpec = { key: '1', numel: n * F, size: [n, F], stride: [F, 1] };
    const arrays = o.arrays ?? 'tensor';
    const writePos = (w: PickleWriter) =>
      void (arrays === 'numpy'
        ? w.numpyArray([n, 3], 'f8', (ww) => void ww.pyBytes(f64Bytes(pos)))
        : w.tensor(posSpec));
    const writeX = (w: PickleWriter) =>
      void (arrays === 'numpy'
        ? w.numpyArray([n, F], 'f8', (ww) => void ww.pyBytes(f64Bytes(x)))
        : w.tensor(xSpec));
    const writeFm = (w: PickleWriter) =>
      void w.dictOf(
        Object.entries(fm).map(([k, r]) => [
          k,
          (ww: PickleWriter) => void ww.mark().int(r[0]).int(r[1]).tuple(),
        ]),
      );
    const graphFields: [string, (w: PickleWriter) => void][] = [
      ['x', writeX],
      ['pos', writePos],
      ['feature_mapping', writeFm],
    ];
    const writeGraph = (w: PickleWriter) => {
      if (o.legacy) {
        w.object('torch_geometric.data.data', 'Data', [
          [
            '_store',
            (ww) =>
              void ww.object('torch_geometric.data.storage', 'GlobalStorage', [
                ['_mapping', (www) => void www.dictOf(graphFields)],
              ]),
          ],
        ]);
      } else {
        w.object('tbp.monty.frameworks.utils.object_model_utils', 'NumpyGraph', graphFields);
      }
    };
    const w = new PickleWriter().proto();
    w.dictOf([
      [
        'lm_dict',
        (w1) =>
          void w1.dictOf([
            [
              0,
              (w2) =>
                void w2.dictOf([
                  [
                    'graph_memory',
                    (w3) =>
                      void w3.dictOf([
                        [
                          graphId,
                          (w4) =>
                            void w4.dictOf([
                              [
                                channel,
                                (w5) =>
                                  void w5.object(
                                    'tbp.monty.frameworks.models.object_model',
                                    o.legacy ? 'GraphObjectModel' : 'GridObjectModel',
                                    [
                                      ['object_id', (w6) => void w6.str(graphId)],
                                      ['_graph', writeGraph],
                                    ],
                                  ),
                              ],
                            ]),
                        ],
                      ]),
                  ],
                ]),
            ],
          ]),
      ],
      ...(o.extraRoot ?? []),
      ['sm_to_lm_matrix', (w1) => void w1.emptyList().mark().emptyList().int(0).append().appends()],
      ['lm_to_lm_matrix', (w1) => void w1.emptyList().mark().emptyList().appends()],
    ]);
    pickle = w.stop().bytes();
    if ((o.arrays ?? 'tensor') === 'tensor') {
      files.push({ name: `${prefix}/data/0`, data: o.pos?.bytes ?? f64Bytes(pos) });
      files.push({ name: `${prefix}/data/1`, data: f64Bytes(x) });
    }
  }
  files.unshift({ name: `${prefix}/data.pkl`, data: pickle });
  files.push({ name: `${prefix}/version`, data: te.encode('3\n') });
  return buildZip(o.files ? o.files(files) : files, o.zip);
}
