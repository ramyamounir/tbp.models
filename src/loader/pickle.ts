/**
 * Protocol-2 pickle VM (spec Phase 2 "Pickle opcodes", "Pickle VM invariants",
 * "Bounds and validation", "Large inline payloads").
 *
 * The pickle is untrusted input: every read is bounds-checked, dicts are `Map`s, only `Handler`
 * instances are ever invoked, unknown classes become inert `Placeholder`s, and large
 * length-prefixed payloads stay zero-copy `LazyBytes` views of the input buffer.
 * The VM is an explicit stack loop (no recursion).
 */
import { ParseError, withByteOffset } from './errors';
import {
  Buildable,
  ClassRef,
  Handler,
  LazyBytes,
  Placeholder,
  type PyDict,
  type PyValue,
} from './pyvalue';

export { LazyBytes, Latin1Bytes, isLazyBytes } from './pyvalue';

/** Payloads above this size (BINUNICODE / BINSTRING / BINBYTES) are kept as `LazyBytes`. */
export const LAZY_PAYLOAD_THRESHOLD = 1 << 12; // 4 KiB (Phase 5: 1 MiB left the 393 MB file's many ~100 KB observation arrays eager)

export interface UnpickleHooks {
  findClass(module: string, name: string): PyValue;
  persistentLoad(pid: PyValue): PyValue;
}

const GLOBAL_LINE_MAX = 256;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

function latin1String(u8: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let k = start; k < end; k += 8192) {
    s += String.fromCharCode(...u8.subarray(k, Math.min(end, k + 8192)));
  }
  return s;
}

const hex = (op: number) => `0x${op.toString(16).padStart(2, '0')}`;

/** Unpickle `u8` (protocol 2). Throws `ParseError` on any malformed input. */
export function unpickle(u8: Uint8Array, hooks: UnpickleHooks): PyValue {
  const len = u8.length;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let i = 0;
  let opPos = 0;
  let stack: PyValue[] = [];
  const metastack: PyValue[][] = [];
  const memo = new Map<number, PyValue>();

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
  const pop = (op: number): PyValue => {
    if (stack.length === 0) throw new ParseError(`Stack underflow in ${opName(op)}`);
    return stack.pop() as PyValue;
  };
  const top = (op: number): PyValue => {
    if (stack.length === 0) throw new ParseError(`Stack underflow in ${opName(op)}`);
    return stack[stack.length - 1];
  };
  const popMark = (op: number): PyValue[] => {
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
  const binstring = (n: number): string | LazyBytes => {
    need(n);
    const start = i;
    i += n;
    if (n > LAZY_PAYLOAD_THRESHOLD) return new LazyBytes(u8.subarray(start, start + n), false);
    return latin1String(u8, start, start + n);
  };
  const binbytes = (n: number): Uint8Array | LazyBytes => {
    need(n);
    const start = i;
    i += n;
    if (n > LAZY_PAYLOAD_THRESHOLD) return new LazyBytes(u8.subarray(start, start + n), false);
    return u8.slice(start, start + n);
  };
  const line = (): string => {
    const start = i;
    const limit = Math.min(len, start + GLOBAL_LINE_MAX);
    let e = start;
    while (e < limit && u8[e] !== 0x0a) e++;
    if (e >= limit) throw new ParseError(`Unterminated GLOBAL at byte ${opPos}`);
    i = e + 1;
    return latin1String(u8, start, e);
  };
  const callClass = (module: string, name: string): PyValue => {
    try {
      return hooks.findClass(module, name);
    } catch (err) {
      throw withByteOffset(err, opPos, `Cannot resolve global ${module}.${name}`);
    }
  };
  const call = (callee: PyValue, args: PyValue, isNew: boolean): PyValue => {
    if (callee instanceof Handler) {
      const fn = isNew ? (callee.construct ?? callee.invoke) : callee.invoke;
      try {
        return fn(args);
      } catch (err) {
        throw withByteOffset(err, opPos, `Bad arguments for ${callee.qname}`);
      }
    }
    if (callee instanceof ClassRef) return new Placeholder(callee.module, callee.name, args);
    return new Placeholder('<invalid>', '<invalid>', args);
  };

  // The stream must start with PROTO 2.
  if (len < 2 || u8[0] !== 0x80) throw new ParseError('Not a pickle (missing PROTO 2 header)');
  if (u8[1] !== 2) throw new ParseError(`Unsupported pickle protocol ${u8[1]}`);
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
        return stack[0];
      }
      case 0x28: // MARK
        metastack.push(stack);
        stack = [];
        break;
      case 0x4e: // NONE
        stack.push(null);
        break;
      case 0x88: // NEWTRUE
        stack.push(true);
        break;
      case 0x89: // NEWFALSE
        stack.push(false);
        break;
      case 0x4b: // BININT1
        stack.push(u8at());
        break;
      case 0x4d: // BININT2
        stack.push(u16());
        break;
      case 0x4a: // BININT
        stack.push(i32());
        break;
      case 0x8a: {
        // LONG1
        const n = u8at();
        if (n > 8) throw new ParseError(`Integer out of range at byte ${opPos}`);
        need(n);
        let v = 0n;
        for (let k = n - 1; k >= 0; k--) v = (v << 8n) | BigInt(u8[i + k]);
        if (n > 0 && u8[i + n - 1] & 0x80) v -= 1n << BigInt(8 * n);
        i += n;
        if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) {
          throw new ParseError(`Integer out of range at byte ${opPos}`);
        }
        stack.push(Number(v));
        break;
      }
      case 0x47: {
        // BINFLOAT (big-endian float64)
        need(8);
        stack.push(dv.getFloat64(i, false));
        i += 8;
        break;
      }
      case 0x58: // BINUNICODE
        stack.push(text(u32()));
        break;
      case 0x8c: // SHORT_BINUNICODE (<= 255 bytes, always eager)
        stack.push(text(u8at()));
        break;
      case 0x54: // BINSTRING (signed 4-byte length)
        stack.push(binstring(i32()));
        break;
      case 0x55: // SHORT_BINSTRING
        stack.push(binstring(u8at()));
        break;
      case 0x42: // BINBYTES
        stack.push(binbytes(u32()));
        break;
      case 0x43: // SHORT_BINBYTES
        stack.push(binbytes(u8at()));
        break;
      case 0x5d: // EMPTY_LIST
        stack.push([]);
        break;
      case 0x7d: // EMPTY_DICT
        stack.push(new Map<PyValue, PyValue>());
        break;
      case 0x29: // EMPTY_TUPLE
        stack.push([]);
        break;
      case 0x74: {
        // TUPLE (pop the mark first: popMark swaps `stack`)
        const items = popMark(op);
        stack.push(items);
        break;
      }
      case 0x85: // TUPLE1
        stack.push([pop(op)]);
        break;
      case 0x86: {
        // TUPLE2
        const b = pop(op);
        const a = pop(op);
        stack.push([a, b]);
        break;
      }
      case 0x87: {
        // TUPLE3
        const c = pop(op);
        const b = pop(op);
        const a = pop(op);
        stack.push([a, b, c]);
        break;
      }
      case 0x61: {
        // APPEND
        const v = pop(op);
        const target = top(op);
        if (!Array.isArray(target)) throw new ParseError(`APPEND on non-list at byte ${opPos}`);
        target.push(v);
        break;
      }
      case 0x65: {
        // APPENDS
        const items = popMark(op);
        const target = top(op);
        if (!Array.isArray(target)) throw new ParseError(`APPEND on non-list at byte ${opPos}`);
        for (const v of items) target.push(v);
        break;
      }
      case 0x73: {
        // SETITEM
        const v = pop(op);
        const k = pop(op);
        const target = top(op);
        if (!(target instanceof Map)) throw new ParseError(`SETITEM on non-dict at byte ${opPos}`);
        (target as PyDict).set(k, v);
        break;
      }
      case 0x75: {
        // SETITEMS
        const kv = popMark(op);
        const target = top(op);
        if (!(target instanceof Map)) throw new ParseError(`SETITEM on non-dict at byte ${opPos}`);
        if (kv.length % 2 !== 0) throw new ParseError(`Odd-length SETITEMS at byte ${opPos}`);
        for (let k = 0; k < kv.length; k += 2) (target as PyDict).set(kv[k], kv[k + 1]);
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
        if (!memo.has(key)) throw new ParseError(`Unknown memo key ${key} at byte ${opPos}`);
        stack.push(memo.get(key) as PyValue);
        break;
      }
      case 0x63: {
        // GLOBAL
        const module = line();
        const name = line();
        stack.push(callClass(module, name));
        break;
      }
      case 0x93: {
        // STACK_GLOBAL
        const name = pop(op);
        const module = pop(op);
        if (typeof module !== 'string' || typeof name !== 'string') {
          throw new ParseError(`STACK_GLOBAL needs two strings at byte ${opPos}`);
        }
        stack.push(callClass(module, name));
        break;
      }
      case 0x52: // REDUCE
      case 0x81: {
        // NEWOBJ
        const args = pop(op);
        const callee = pop(op);
        stack.push(call(callee, args, op === 0x81));
        break;
      }
      case 0x62: {
        // BUILD
        const state = pop(op);
        const target = top(op);
        if (target instanceof Placeholder) {
          if (target.state !== undefined) {
            throw new ParseError(`BUILD applied twice to the same object at byte ${opPos}`);
          }
          target.state = state;
        } else if (target instanceof Buildable) {
          try {
            target.setState(state);
          } catch (err) {
            throw withByteOffset(err, opPos, 'Bad BUILD state');
          }
        } else if (state !== null) {
          throw new ParseError(`BUILD on unsupported object at byte ${opPos}`);
        }
        break;
      }
      case 0x51: {
        // BINPERSID
        const pid = pop(op);
        try {
          stack.push(hooks.persistentLoad(pid));
        } catch (err) {
          throw withByteOffset(err, opPos, 'Bad persistent id');
        }
        break;
      }
      default:
        throw new ParseError(`Unknown pickle opcode ${hex(op)} at byte ${opPos}`);
    }
  }
}
