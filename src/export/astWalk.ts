/**
 * Read-only helpers over a `PNode` tree shared by the Phase 4b exporter modules (spec Phase 4a
 * "Traversal rule": every walk is iterative with an identity visited set).
 */
import { LazyBytes, type PNode, type PObj } from './pickleAst';
import { forEachChild } from './pickleWrite';

export { forEachChild };

const utf8 = new TextDecoder('utf-8');

/** Decoded text of a `str` payload (a LazyBytes value is decoded as utf-8). */
export function decodeText(v: string | LazyBytes): string {
  return typeof v === 'string' ? v : utf8.decode(v.view);
}

/** Raw bytes of a `bstr` / `bytes` payload. */
export function payloadBytes(v: Uint8Array | LazyBytes): Uint8Array {
  return v instanceof LazyBytes ? v.view : v;
}

function latin1(u8: Uint8Array): string {
  let s = '';
  for (let k = 0; k < u8.length; k += 8192) {
    s += String.fromCharCode(...u8.subarray(k, Math.min(u8.length, k + 8192)));
  }
  return s;
}

/** Decoded value of a `str` (utf-8) or `bstr` (latin-1, as the loader) node, else undefined. */
export function strValue(n: PNode | undefined): string | undefined {
  if (!n) return undefined;
  if (n.t === 'str') return decodeText(n.v);
  if (n.t === 'bstr') return latin1(payloadBytes(n.v));
  return undefined;
}

/** Two's-complement little-endian LONG1 payload as a BigInt. */
export function longValue(raw: Uint8Array): bigint {
  let v = 0n;
  for (let k = raw.length - 1; k >= 0; k--) v = (v << 8n) | BigInt(raw[k]);
  if (raw.length > 0 && raw[raw.length - 1] & 0x80) v -= 1n << BigInt(8 * raw.length);
  return v;
}

/** Integer value of an `int` node, or of a `long` node that fits a safe integer. */
export function intValue(n: PNode | undefined): number | undefined {
  if (!n) return undefined;
  if (n.t === 'int') return n.v;
  if (n.t === 'long') {
    const b = longValue(n.raw);
    if (b > BigInt(Number.MAX_SAFE_INTEGER) || b < BigInt(Number.MIN_SAFE_INTEGER))
      return undefined;
    return Number(b);
  }
  return undefined;
}

/** The [key, value] pairs of a dict-like node (`dict`, or an `obj`'s SETITEMS items). */
export function dictPairs(n: PNode | undefined): [PNode, PNode][] | undefined {
  if (!n) return undefined;
  if (n.t === 'dict') return n.items;
  if (n.t === 'obj' && n.dictItems) return n.dictItems;
  return undefined;
}

function keyMatches(k: PNode, key: string | number): boolean {
  if (typeof key === 'number') return intValue(k) === key;
  return strValue(k) === key;
}

/** The first [key, value] pair of a dict-like node whose key is `key` (string or int). */
export function dictPair(n: PNode | undefined, key: string | number): [PNode, PNode] | undefined {
  const pairs = dictPairs(n);
  if (!pairs) return undefined;
  for (const p of pairs) if (keyMatches(p[0], key)) return p;
  return undefined;
}

/** Value of `key` in a dict-like node. */
export function dictGet(n: PNode | undefined, key: string | number): PNode | undefined {
  return dictPair(n, key)?.[1];
}

/** The state dict of an obj (its state dict, or the `__dict__` of a `(dict, slots)` tuple). */
function stateDicts(o: PObj): PNode[] {
  const s = o.state;
  if (!s) return [];
  if (s.t === 'dict') return [s];
  if (s.t === 'tuple' && s.items.length === 2) return s.items.filter((d) => d.t === 'dict');
  return [];
}

/**
 * The [name, value] pair of attribute `name`: from a dict node, from an obj's state dict (or the
 * dict / slots of a `(dict, slots)` state tuple), else from an obj's SETITEMS items.
 */
export function attrPair(n: PNode | undefined, name: string): [PNode, PNode] | undefined {
  if (!n) return undefined;
  if (n.t === 'dict') return dictPair(n, name);
  if (n.t !== 'obj') return undefined;
  for (const d of stateDicts(n)) {
    const p = dictPair(d, name);
    if (p) return p;
  }
  if (n.dictItems) return dictPair(n, name);
  return undefined;
}

/** Value of attribute `name` (see attrPair). */
export function attr(n: PNode | undefined, name: string): PNode | undefined {
  return attrPair(n, name)?.[1];
}

/** True when `n` is a global node `module.name`. */
export function isGlobal(n: PNode | undefined, module: string, name: string): boolean {
  return !!n && n.t === 'global' && n.module === module && n.name === name;
}

/** Hex of bytes (for canonical dict keys). */
export function hexOf(u8: Uint8Array): string {
  let s = '';
  for (const b of u8) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Canonical key of a dict key node, equal for keys Python treats as equal: `str` by decoded
 * value, `bstr` / `bytes` by content, numbers (`int`, `bool`, `float`, `long`) by value.
 * Returns undefined for other kinds (compared by identity).
 */
export function canonKey(k: PNode): string | undefined {
  switch (k.t) {
    case 'str':
      return `s:${decodeText(k.v)}`;
    case 'bstr':
    case 'bytes':
      return `b:${hexOf(payloadBytes(k.v))}`;
    case 'bool':
      return `n:${k.v ? 1 : 0}`;
    case 'int':
      return `n:${k.v}`;
    case 'long':
      return `n:${longValue(k.raw).toString()}`;
    case 'float':
      if (Number.isInteger(k.v)) return `n:${BigInt(k.v).toString()}`;
      if (Number.isNaN(k.v)) return undefined; // NaN != NaN in Python
      return `n:${k.v}`;
    case 'none':
      return 'none';
    default:
      return undefined;
  }
}
