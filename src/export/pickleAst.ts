/**
 * Symbolic, lossless protocol-2 pickle reader for export (spec Phase 4a "AST nodes").
 *
 * Mirrors the control flow and bounds checks of `src/loader/pickle.ts` but calls no handlers:
 * every opcode becomes a node that keeps its meaning, and object identity (memo, shared
 * objects, cycles) is kept as shared references in the tree. Large payloads stay zero-copy
 * `LazyBytes` views of the input buffer, which must outlive the write.
 */
import { ParseError } from '../loader/errors';
import { LAZY_PAYLOAD_THRESHOLD, LazyBytes } from '../loader/pickle';

export { LazyBytes };

export type PNode =
  | { t: 'none' }
  | { t: 'bool'; v: boolean }
  | { t: 'int'; v: number } // BININT1 / BININT2 / BININT
  | { t: 'long'; raw: Uint8Array } // LONG1 payload, written back verbatim
  | { t: 'float'; v: number } // BINFLOAT
  | { t: 'str'; v: string | LazyBytes } // BINUNICODE / SHORT_BINUNICODE (utf-8)
  | { t: 'bstr'; v: Uint8Array | LazyBytes } // BINSTRING / SHORT_BINSTRING (raw bytes)
  | { t: 'bytes'; v: Uint8Array | LazyBytes } // BINBYTES / SHORT_BINBYTES
  | { t: 'tuple'; items: PNode[] }
  | { t: 'list'; items: PNode[] }
  | { t: 'dict'; items: [PNode, PNode][] } // insertion order preserved, keys not hashed
  | { t: 'global'; module: string; name: string }
  | {
      t: 'obj';
      via: 'reduce' | 'newobj';
      fn: PNode;
      args: PNode;
      state?: PNode; // BUILD
      listItems?: PNode[]; // APPEND(S) on a non-list (e.g. list subclass)
      dictItems?: [PNode, PNode][]; // SETITEM(S) on a non-dict (OrderedDict, defaultdict)
    }
  | { t: 'persid'; pid: PNode }; // BINPERSID

export interface PickleAst {
  proto: number;
  root: PNode;
}

export type PObj = Extract<PNode, { t: 'obj' }>;

export const NONE_NODE: PNode = Object.freeze({ t: 'none' });
export const TRUE_NODE: PNode = Object.freeze({ t: 'bool', v: true });
export const FALSE_NODE: PNode = Object.freeze({ t: 'bool', v: false });

/** Upper bound on the nodes of one parsed tree (memory of the tree and of every traversal). */
export const MAX_AST_NODES = 50_000_000;

const GLOBAL_LINE_MAX = 256;
const utf8Decoder = new TextDecoder('utf-8', { fatal: true });
const hex = (op: number) => `0x${op.toString(16).padStart(2, '0')}`;

/** True when every char code of `s` is printable ASCII without space (0x21-0x7e) and `s` is non-empty. */
export function isGlobalNameText(s: string): boolean {
  if (s.length === 0) return false;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c < 0x21 || c > 0x7e) return false;
  }
  return true;
}

/** Parse `u8` (protocol 2) into a lossless node tree. Throws `ParseError` on malformed input. */
export function readPickleAst(u8: Uint8Array): PickleAst {
  const len = u8.length;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let i = 0;
  let opPos = 0;
  let stack: PNode[] = [];
  const metastack: PNode[][] = [];
  const memo = new Map<number, PNode>();
  let count = 0;

  const node = <T extends PNode>(n: T): T => {
    if (++count > MAX_AST_NODES) {
      throw new ParseError(
        `File too complex to export (more than ${MAX_AST_NODES} pickle objects)`,
      );
    }
    return n;
  };
  const need = (n: number) => {
    if (n < 0 || i + n > len) throw new ParseError(`Truncated pickle at byte ${i}`);
  };
  const u8at = () => {
    need(1);
    return u8[i++];
  };
  const u16 = () => {
    need(2);
    const v = dv.getUint16(i, true);
    i += 2;
    return v;
  };
  const u32 = () => {
    need(4);
    const v = dv.getUint32(i, true);
    i += 4;
    return v;
  };
  const i32 = () => {
    need(4);
    const v = dv.getInt32(i, true);
    i += 4;
    return v;
  };
  const opName = (op: number) => `opcode ${hex(op)} at byte ${opPos}`;
  const pop = (op: number): PNode => {
    if (stack.length === 0) throw new ParseError(`Stack underflow in ${opName(op)}`);
    return stack.pop() as PNode;
  };
  const top = (op: number): PNode => {
    if (stack.length === 0) throw new ParseError(`Stack underflow in ${opName(op)}`);
    return stack[stack.length - 1];
  };
  const popMark = (op: number): PNode[] => {
    const prev = metastack.pop();
    if (!prev) throw new ParseError(`MARK underflow in ${opName(op)}`);
    const items = stack;
    stack = prev;
    return items;
  };
  const text = (n: number): string | LazyBytes => {
    need(n);
    const start = i;
    i += n;
    if (n > LAZY_PAYLOAD_THRESHOLD) return new LazyBytes(u8.subarray(start, start + n), true);
    try {
      return utf8Decoder.decode(u8.subarray(start, start + n));
    } catch {
      throw new ParseError(`Invalid UTF-8 at byte ${start}`);
    }
  };
  const raw = (n: number): Uint8Array | LazyBytes => {
    need(n);
    const start = i;
    i += n;
    if (n > LAZY_PAYLOAD_THRESHOLD) return new LazyBytes(u8.subarray(start, start + n), false);
    return u8.slice(start, start + n);
  };
  const badGlobal = () => new ParseError(`Unsupported global name at byte ${opPos}`);
  /** One GLOBAL line, checked as raw bytes (0x21-0x7e only) before decoding. */
  const globalLine = (): string => {
    const start = i;
    const limit = Math.min(len, start + GLOBAL_LINE_MAX);
    let e = start;
    while (e < limit && u8[e] !== 0x0a) e++;
    if (e >= limit) throw new ParseError(`Unterminated GLOBAL at byte ${opPos}`);
    if (e === start) throw badGlobal();
    let s = '';
    for (let k = start; k < e; k++) {
      const c = u8[k];
      if (c < 0x21 || c > 0x7e) throw badGlobal();
      s += String.fromCharCode(c);
    }
    i = e + 1;
    return s;
  };
  const stackGlobalText = (n: PNode): string => {
    if (n.t !== 'str') throw badGlobal();
    let s: string;
    if (typeof n.v === 'string') s = n.v;
    else {
      try {
        s = utf8Decoder.decode(n.v.view);
      } catch {
        throw badGlobal();
      }
    }
    if (!isGlobalNameText(s)) throw badGlobal();
    return s;
  };

  // The stream must start with PROTO 2 (as in pickle.ts).
  if (len < 2 || u8[0] !== 0x80) throw new ParseError('Not a pickle (missing PROTO 2 header)');
  if (u8[1] !== 2) throw new ParseError(`Unsupported pickle protocol ${u8[1]}`);
  const proto = u8[1];
  i = 2;

  for (;;) {
    opPos = i;
    const op = u8at();
    switch (op) {
      case 0x80: // PROTO (only allowed at the start)
        throw new ParseError(`Unexpected PROTO at byte ${opPos}`);
      case 0x2e: {
        // STOP
        if (metastack.length !== 0 || stack.length !== 1) {
          throw new ParseError(`Malformed pickle: unbalanced stack at STOP (byte ${opPos})`);
        }
        return { proto, root: stack[0] };
      }
      case 0x28: // MARK
        metastack.push(stack);
        stack = [];
        break;
      case 0x4e: // NONE
        stack.push(NONE_NODE);
        break;
      case 0x88: // NEWTRUE
        stack.push(TRUE_NODE);
        break;
      case 0x89: // NEWFALSE
        stack.push(FALSE_NODE);
        break;
      case 0x4b: // BININT1
        stack.push(node({ t: 'int', v: u8at() }));
        break;
      case 0x4d: // BININT2
        stack.push(node({ t: 'int', v: u16() }));
        break;
      case 0x4a: // BININT
        stack.push(node({ t: 'int', v: i32() }));
        break;
      case 0x8a: {
        // LONG1: payload kept verbatim
        const n = u8at();
        need(n);
        stack.push(node({ t: 'long', raw: u8.slice(i, i + n) }));
        i += n;
        break;
      }
      case 0x47: {
        // BINFLOAT (big-endian float64)
        need(8);
        stack.push(node({ t: 'float', v: dv.getFloat64(i, false) }));
        i += 8;
        break;
      }
      case 0x58: // BINUNICODE
        stack.push(node({ t: 'str', v: text(u32()) }));
        break;
      case 0x8c: // SHORT_BINUNICODE
        stack.push(node({ t: 'str', v: text(u8at()) }));
        break;
      case 0x54: // BINSTRING (signed 4-byte length)
        stack.push(node({ t: 'bstr', v: raw(i32()) }));
        break;
      case 0x55: // SHORT_BINSTRING
        stack.push(node({ t: 'bstr', v: raw(u8at()) }));
        break;
      case 0x42: // BINBYTES
        stack.push(node({ t: 'bytes', v: raw(u32()) }));
        break;
      case 0x43: // SHORT_BINBYTES
        stack.push(node({ t: 'bytes', v: raw(u8at()) }));
        break;
      case 0x5d: // EMPTY_LIST
        stack.push(node({ t: 'list', items: [] }));
        break;
      case 0x7d: // EMPTY_DICT
        stack.push(node({ t: 'dict', items: [] }));
        break;
      case 0x29: // EMPTY_TUPLE
        stack.push(node({ t: 'tuple', items: [] }));
        break;
      case 0x74: {
        // TUPLE (pop the mark first: popMark swaps `stack`)
        const items = popMark(op);
        stack.push(node({ t: 'tuple', items }));
        break;
      }
      case 0x85: // TUPLE1
        stack.push(node({ t: 'tuple', items: [pop(op)] }));
        break;
      case 0x86: {
        // TUPLE2
        const b = pop(op);
        const a = pop(op);
        stack.push(node({ t: 'tuple', items: [a, b] }));
        break;
      }
      case 0x87: {
        // TUPLE3
        const c = pop(op);
        const b = pop(op);
        const a = pop(op);
        stack.push(node({ t: 'tuple', items: [a, b, c] }));
        break;
      }
      case 0x61: // APPEND
      case 0x65: {
        // APPENDS
        const items = op === 0x61 ? [pop(op)] : popMark(op);
        const target = top(op);
        if (target.t === 'list') {
          for (const v of items) target.items.push(v);
        } else if (target.t === 'obj') {
          const dst = (target.listItems ??= []);
          for (const v of items) dst.push(v);
        } else {
          throw new ParseError(`APPEND on non-list at byte ${opPos}`);
        }
        break;
      }
      case 0x73: // SETITEM
      case 0x75: {
        // SETITEMS
        let kv: PNode[];
        if (op === 0x73) {
          const v = pop(op);
          const k = pop(op);
          kv = [k, v];
        } else {
          kv = popMark(op);
          if (kv.length % 2 !== 0) throw new ParseError(`Odd-length SETITEMS at byte ${opPos}`);
        }
        const target = top(op);
        let dst: [PNode, PNode][];
        if (target.t === 'dict') dst = target.items;
        else if (target.t === 'obj') dst = target.dictItems ??= [];
        else throw new ParseError(`SETITEM on non-dict at byte ${opPos}`);
        for (let k = 0; k < kv.length; k += 2) dst.push([kv[k], kv[k + 1]]);
        break;
      }
      case 0x71: // BINPUT
        memo.set(u8at(), top(op));
        break;
      case 0x72: // LONG_BINPUT
        memo.set(u32(), top(op));
        break;
      case 0x68: // BINGET
      case 0x6a: {
        // LONG_BINGET
        const key = op === 0x68 ? u8at() : u32();
        const v = memo.get(key);
        if (v === undefined) throw new ParseError(`Unknown memo key ${key} at byte ${opPos}`);
        stack.push(v);
        break;
      }
      case 0x63: {
        // GLOBAL
        const module = globalLine();
        const name = globalLine();
        stack.push(node({ t: 'global', module, name }));
        break;
      }
      case 0x93: {
        // STACK_GLOBAL
        const nameNode = pop(op);
        const moduleNode = pop(op);
        const module = stackGlobalText(moduleNode);
        const name = stackGlobalText(nameNode);
        stack.push(node({ t: 'global', module, name }));
        break;
      }
      case 0x52: // REDUCE
      case 0x81: {
        // NEWOBJ
        const args = pop(op);
        const fn = pop(op);
        stack.push(node({ t: 'obj', via: op === 0x81 ? 'newobj' : 'reduce', fn, args }));
        break;
      }
      case 0x62: {
        // BUILD
        const state = pop(op);
        const target = top(op);
        if (target.t === 'obj') {
          if (target.state !== undefined) {
            throw new ParseError(`BUILD applied twice to the same object at byte ${opPos}`);
          }
          target.state = state;
        } else if (state.t !== 'none') {
          // BUILD None on a plain container is a no-op in CPython (dropped here).
          throw new ParseError(`BUILD on unsupported object at byte ${opPos}`);
        }
        break;
      }
      case 0x51: // BINPERSID
        stack.push(node({ t: 'persid', pid: pop(op) }));
        break;
      default:
        throw new ParseError(`Unknown pickle opcode ${hex(op)} at byte ${opPos}`);
    }
  }
}
