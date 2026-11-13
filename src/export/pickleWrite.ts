/**
 * Protocol-2 pickle writer for a `PickleAst` (spec Phase 4a "Writer").
 *
 * Memo indices are assigned afresh: a node is memoised only when it is reached more than once.
 * Both passes are iterative (explicit stacks, identity maps), so deep and cyclic trees are
 * fine. Lists, dicts and objects are memoised before their contents are written, as CPython
 * does, so cycles through them are valid; a tuple or REDUCE argument that reaches itself is
 * refused. Output is a list of chunks; large payloads are the original zero-copy views.
 */
import { ParseError } from '../loader/errors';
import { LAZY_PAYLOAD_THRESHOLD, LazyBytes } from '../loader/pickle';
import { isGlobalNameText, type PickleAst, type PNode } from './pickleAst';

const OP = {
  PROTO: 0x80,
  STOP: 0x2e,
  MARK: 0x28,
  NONE: 0x4e,
  NEWTRUE: 0x88,
  NEWFALSE: 0x89,
  BININT1: 0x4b,
  BININT2: 0x4d,
  BININT: 0x4a,
  LONG1: 0x8a,
  BINFLOAT: 0x47,
  BINUNICODE: 0x58,
  BINSTRING: 0x54,
  SHORT_BINSTRING: 0x55,
  BINBYTES: 0x42,
  SHORT_BINBYTES: 0x43,
  EMPTY_LIST: 0x5d,
  EMPTY_DICT: 0x7d,
  EMPTY_TUPLE: 0x29,
  TUPLE: 0x74,
  TUPLE1: 0x85,
  TUPLE2: 0x86,
  TUPLE3: 0x87,
  APPEND: 0x61,
  APPENDS: 0x65,
  SETITEM: 0x73,
  SETITEMS: 0x75,
  BINPUT: 0x71,
  LONG_BINPUT: 0x72,
  BINGET: 0x68,
  LONG_BINGET: 0x6a,
  GLOBAL: 0x63,
  REDUCE: 0x52,
  NEWOBJ: 0x81,
  BUILD: 0x62,
  BINPERSID: 0x51,
} as const;

const BATCH = 1000;
const BUF_SIZE = 1 << 20; // 1 MiB
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;
const encoder = new TextEncoder();

/** Nodes that take part in memoisation (all but none / bool / int / long / float). */
function isMemoisable(n: PNode): boolean {
  switch (n.t) {
    case 'none':
    case 'bool':
    case 'int':
    case 'long':
    case 'float':
      return false;
    default:
      return true;
  }
}

/** Calls `f` for every child of `n`, in the traversal order of the spec. */
export function forEachChild(n: PNode, f: (c: PNode) => void): void {
  switch (n.t) {
    case 'tuple':
    case 'list':
      for (const c of n.items) f(c);
      break;
    case 'dict':
      for (const [k, v] of n.items) {
        f(k);
        f(v);
      }
      break;
    case 'obj':
      f(n.fn);
      f(n.args);
      if (n.state !== undefined) f(n.state);
      if (n.listItems) for (const c of n.listItems) f(c);
      if (n.dictItems)
        for (const [k, v] of n.dictItems) {
          f(k);
          f(v);
        }
      break;
    case 'persid':
      f(n.pid);
      break;
    default:
      break;
  }
}

/** For every memoisable node, how many times it is reached as a child (the root counts once more). */
function countRefs(root: PNode): Map<PNode, number> {
  const refs = new Map<PNode, number>();
  if (!isMemoisable(root)) return refs;
  refs.set(root, 1);
  const stack: PNode[] = [root];
  const visit = (c: PNode) => {
    if (!isMemoisable(c)) return;
    const r = refs.get(c);
    if (r === undefined) {
      refs.set(c, 1);
      stack.push(c); // first visit: descend once
    } else {
      refs.set(c, r + 1);
    }
  };
  while (stack.length > 0) forEachChild(stack.pop() as PNode, visit);
  return refs;
}

/** Growable chunked output: small writes go to 1 MiB buffers, big payloads become own chunks. */
class Out {
  readonly chunks: Uint8Array[] = [];
  private buf = new Uint8Array(BUF_SIZE);
  private dv = new DataView(this.buf.buffer);
  private pos = 0;

  private room(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    this.flush();
    if (n > this.buf.length) {
      this.buf = new Uint8Array(n);
      this.dv = new DataView(this.buf.buffer);
    }
  }
  flush(): void {
    if (this.pos > 0) {
      this.chunks.push(this.buf.subarray(0, this.pos));
      this.buf = new Uint8Array(BUF_SIZE);
      this.dv = new DataView(this.buf.buffer);
      this.pos = 0;
    }
  }
  op(b: number): void {
    this.room(1);
    this.buf[this.pos++] = b;
  }
  opU8(b: number, v: number): void {
    this.room(2);
    this.buf[this.pos++] = b;
    this.buf[this.pos++] = v;
  }
  opU16(b: number, v: number): void {
    this.room(3);
    this.buf[this.pos++] = b;
    this.dv.setUint16(this.pos, v, true);
    this.pos += 2;
  }
  opU32(b: number, v: number): void {
    this.room(5);
    this.buf[this.pos++] = b;
    this.dv.setUint32(this.pos, v, true);
    this.pos += 4;
  }
  opI32(b: number, v: number): void {
    this.room(5);
    this.buf[this.pos++] = b;
    this.dv.setInt32(this.pos, v, true);
    this.pos += 4;
  }
  opF64(b: number, v: number): void {
    this.room(9);
    this.buf[this.pos++] = b;
    this.dv.setFloat64(this.pos, v, false);
    this.pos += 8;
  }
  /** Raw payload bytes: copied when small, appended as its own chunk (no copy) when large. */
  bytes(u8: Uint8Array): void {
    if (u8.length > LAZY_PAYLOAD_THRESHOLD) {
      this.flush();
      this.chunks.push(u8);
      return;
    }
    this.room(u8.length);
    this.buf.set(u8, this.pos);
    this.pos += u8.length;
  }
  finish(): Uint8Array[] {
    this.flush();
    return this.chunks;
  }
}

const payload = (v: string | Uint8Array | LazyBytes): Uint8Array =>
  typeof v === 'string' ? encoder.encode(v) : v instanceof LazyBytes ? v.view : v;

/** Signed little-endian two's-complement bytes of `v`, minimal length (LONG1 payload). */
function longBytes(v: bigint): Uint8Array {
  if (v === 0n) return new Uint8Array(0);
  const out: number[] = [];
  let x = v;
  for (;;) {
    const byte = Number(x & 0xffn);
    out.push(byte);
    x >>= 8n;
    if ((x === 0n && (byte & 0x80) === 0) || (x === -1n && (byte & 0x80) !== 0)) break;
  }
  return new Uint8Array(out);
}

// Work items of the emission pass.
const K = {
  Node: 0, // emit `n`
  Op: 1, // emit opcode `op`
  TupleEnd: 2, // all items of tuple `n` written: TUPLEn / TUPLE, put
  ObjCall: 3, // fn and args of obj `n` written: REDUCE / NEWOBJ, put, then the tail
  PersidEnd: 4, // pid written: BINPERSID, put
  Seq: 5, // append items[i..] of a list (or obj listItems) in batches
  Pairs: 6, // set pairs[i..] of a dict (or obj dictItems) in batches
} as const;
type Task =
  | { k: typeof K.Node; n: PNode }
  | { k: typeof K.Op; op: number }
  | { k: typeof K.TupleEnd | typeof K.ObjCall | typeof K.PersidEnd; n: PNode }
  | { k: typeof K.Seq; items: PNode[]; i: number }
  | { k: typeof K.Pairs; items: [PNode, PNode][]; i: number };

const IN_PROGRESS = 1;
const EMITTED = 2;

/** Write `ast` as a protocol-2 pickle. Returns the output chunks. */
export function writePickle(ast: PickleAst): Uint8Array[] {
  if (ast.proto !== 2) throw new ParseError(`Unsupported pickle protocol ${ast.proto}`);
  const refs = countRefs(ast.root);
  const state = new Map<PNode, number>();
  const memoIndex = new Map<PNode, number>();
  let nextMemo = 0;
  const out = new Out();

  const put = (n: PNode) => {
    state.set(n, EMITTED);
    if ((refs.get(n) ?? 0) <= 1) return;
    const idx = nextMemo++;
    memoIndex.set(n, idx);
    if (idx < 256) out.opU8(OP.BINPUT, idx);
    else out.opU32(OP.LONG_BINPUT, idx);
  };

  const work: Task[] = [{ k: K.Node, n: ast.root }];
  out.opU8(OP.PROTO, ast.proto);

  const emitNode = (n: PNode) => {
    // Atoms: written by value every time.
    switch (n.t) {
      case 'none':
        out.op(OP.NONE);
        return;
      case 'bool':
        out.op(n.v ? OP.NEWTRUE : OP.NEWFALSE);
        return;
      case 'int': {
        const v = n.v;
        if (!Number.isInteger(v)) throw new ParseError('internal: non-integer int node');
        if (v >= 0 && v < 256) out.opU8(OP.BININT1, v);
        else if (v >= 256 && v < 65536) out.opU16(OP.BININT2, v);
        else if (v >= INT32_MIN && v <= INT32_MAX) out.opI32(OP.BININT, v);
        else {
          const raw = longBytes(BigInt(v));
          out.opU8(OP.LONG1, raw.length);
          out.bytes(raw);
        }
        return;
      }
      case 'long':
        if (n.raw.length > 255) throw new ParseError('internal: LONG1 payload too long');
        out.opU8(OP.LONG1, n.raw.length);
        out.bytes(n.raw);
        return;
      case 'float':
        out.opF64(OP.BINFLOAT, n.v);
        return;
      default:
        break;
    }
    const st = state.get(n);
    if (st === EMITTED) {
      const idx = memoIndex.get(n);
      if (idx === undefined) throw new ParseError('internal: memoised node without index');
      if (idx < 256) out.opU8(OP.BINGET, idx);
      else out.opU32(OP.LONG_BINGET, idx);
      return;
    }
    if (st === IN_PROGRESS) {
      throw new ParseError('Recursive tuple or reduce arguments cannot be exported');
    }
    state.set(n, IN_PROGRESS);
    switch (n.t) {
      case 'str': {
        const b = payload(n.v);
        out.opU32(OP.BINUNICODE, b.length);
        out.bytes(b);
        put(n);
        return;
      }
      case 'bstr': {
        const b = payload(n.v);
        if (b.length < 256) out.opU8(OP.SHORT_BINSTRING, b.length);
        else if (b.length <= INT32_MAX) out.opI32(OP.BINSTRING, b.length);
        else throw new ParseError('String too long to export');
        out.bytes(b);
        put(n);
        return;
      }
      case 'bytes': {
        const b = payload(n.v);
        if (b.length < 256) out.opU8(OP.SHORT_BINBYTES, b.length);
        else out.opU32(OP.BINBYTES, b.length);
        out.bytes(b);
        put(n);
        return;
      }
      case 'global': {
        if (!isGlobalNameText(n.module) || !isGlobalNameText(n.name)) {
          throw new ParseError('Unsupported global name');
        }
        out.op(OP.GLOBAL);
        out.bytes(encoder.encode(`${n.module}\n${n.name}\n`));
        put(n);
        return;
      }
      case 'list':
        out.op(OP.EMPTY_LIST);
        put(n);
        if (n.items.length) work.push({ k: K.Seq, items: n.items, i: 0 });
        return;
      case 'dict':
        out.op(OP.EMPTY_DICT);
        put(n);
        if (n.items.length) work.push({ k: K.Pairs, items: n.items, i: 0 });
        return;
      case 'tuple': {
        const items = n.items;
        if (items.length === 0) {
          out.op(OP.EMPTY_TUPLE);
          put(n);
          return;
        }
        if (items.length > 3) out.op(OP.MARK);
        work.push({ k: K.TupleEnd, n });
        for (let k = items.length - 1; k >= 0; k--) work.push({ k: K.Node, n: items[k] });
        return;
      }
      case 'obj':
        work.push({ k: K.ObjCall, n });
        work.push({ k: K.Node, n: n.args });
        work.push({ k: K.Node, n: n.fn });
        return;
      case 'persid':
        work.push({ k: K.PersidEnd, n });
        work.push({ k: K.Node, n: n.pid });
        return;
      default:
        throw new ParseError('internal: unknown pickle node');
    }
  };

  while (work.length > 0) {
    const task = work.pop() as Task;
    switch (task.k) {
      case K.Node:
        emitNode(task.n);
        break;
      case K.Op:
        out.op(task.op);
        break;
      case K.TupleEnd: {
        const n = task.n as Extract<PNode, { t: 'tuple' }>;
        const c = n.items.length;
        out.op(c === 1 ? OP.TUPLE1 : c === 2 ? OP.TUPLE2 : c === 3 ? OP.TUPLE3 : OP.TUPLE);
        put(n);
        break;
      }
      case K.ObjCall: {
        const n = task.n as Extract<PNode, { t: 'obj' }>;
        out.op(n.via === 'newobj' ? OP.NEWOBJ : OP.REDUCE);
        put(n);
        // Tail, in order: listItems, dictItems, then state BUILD (pushed in reverse).
        if (n.state !== undefined) {
          work.push({ k: K.Op, op: OP.BUILD });
          work.push({ k: K.Node, n: n.state });
        }
        if (n.dictItems?.length) work.push({ k: K.Pairs, items: n.dictItems, i: 0 });
        if (n.listItems?.length) work.push({ k: K.Seq, items: n.listItems, i: 0 });
        break;
      }
      case K.PersidEnd:
        out.op(OP.BINPERSID);
        put(task.n);
        break;
      case K.Seq: {
        const { items, i } = task;
        const end = Math.min(items.length, i + BATCH);
        if (end < items.length) work.push({ k: K.Seq, items, i: end });
        if (end - i === 1) {
          work.push({ k: K.Op, op: OP.APPEND });
          work.push({ k: K.Node, n: items[i] });
        } else {
          out.op(OP.MARK);
          work.push({ k: K.Op, op: OP.APPENDS });
          for (let k = end - 1; k >= i; k--) work.push({ k: K.Node, n: items[k] });
        }
        break;
      }
      case K.Pairs: {
        const { items, i } = task;
        const end = Math.min(items.length, i + BATCH);
        if (end < items.length) work.push({ k: K.Pairs, items, i: end });
        if (end - i === 1) {
          work.push({ k: K.Op, op: OP.SETITEM });
          work.push({ k: K.Node, n: items[i][1] });
          work.push({ k: K.Node, n: items[i][0] });
        } else {
          out.op(OP.MARK);
          work.push({ k: K.Op, op: OP.SETITEMS });
          for (let k = end - 1; k >= i; k--) {
            work.push({ k: K.Node, n: items[k][1] });
            work.push({ k: K.Node, n: items[k][0] });
          }
        }
        break;
      }
    }
  }
  out.op(OP.STOP);
  return out.finish();
}
