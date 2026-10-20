/**
 * numpy reconstruction for pickled arrays (spec Phase 2 "findClass table", "Large inline
 * payloads"). Arrays keep their raw payload unread; `numpyArrayData()` is the only place that
 * materializes payload bytes, and monty.ts calls it only on the fixed graph paths.
 */
import { ParseError } from './errors';
import { Buildable, LazyBytes, Latin1Bytes, Placeholder, isIndex, type PyValue } from './pyvalue';

/** Number of lazy payloads materialized so far (tests assert unread payloads stay unread). */
export let materializeCount = 0;
export function resetMaterializeCount(): void {
  materializeCount = 0;
}

const MAX_NDIM = 32;
const BYTE_ORDERS = new Set(['<', '>', '|', '=']);

/** Decoded dtype descriptor (`numpy.dtype('f8', False, True)` + BUILD `(3, '<', ...)`). */
export class NumpyDtype extends Buildable {
  byteOrder = '=';
  private built = false;
  readonly kind: string; // 'f' | 'i' | 'u' | 'b' | 'S' | 'U' | 'O' | 'V' | ...
  readonly itemsize: number; // 0 when unknown (e.g. 'O')
  readonly code: string;
  constructor(code: string) {
    super();
    this.code = code;
    const m = /^([a-zA-Z])(\d*)$/.exec(code);
    this.kind = m ? m[1] : '?';
    this.itemsize = m && m[2] !== '' ? Number(m[2]) : 0;
  }
  setState(state: PyValue): void {
    if (this.built) throw new ParseError('Bad BUILD state for numpy.dtype (built twice)');
    if (!Array.isArray(state) || state.length < 2 || typeof state[1] !== 'string') {
      throw new ParseError('Bad BUILD state for numpy.dtype');
    }
    if (!BYTE_ORDERS.has(state[1]))
      throw new ParseError(`Bad byte order ${state[1]} for numpy.dtype`);
    this.byteOrder = state[1];
    this.built = true;
  }
  /** Numeric dtypes that can be read as graph arrays. */
  get numeric(): boolean {
    return (
      (this.kind === 'f' && (this.itemsize === 2 || this.itemsize === 4 || this.itemsize === 8)) ||
      ((this.kind === 'i' || this.kind === 'u') && [1, 2, 4, 8].includes(this.itemsize)) ||
      (this.kind === 'b' && this.itemsize === 1)
    );
  }
  get bigEndian(): boolean {
    return this.byteOrder === '>' && this.itemsize > 1;
  }
}

/** Array created empty by `_reconstruct`, filled by BUILD `(version, shape, dtype, isFortran, raw)`. */
export class NumpyArray extends Buildable {
  shape: number[] = [];
  dtype: NumpyDtype | undefined = undefined;
  fortran = false;
  /** string-derived bytes, LazyBytes, Latin1Bytes or (object arrays) a list: stored unread. */
  raw: PyValue = null;
  private built = false;
  setState(state: PyValue): void {
    if (this.built) throw new ParseError('Bad BUILD state for numpy array (built twice)');
    if (!Array.isArray(state) || state.length !== 5) {
      throw new ParseError('Bad BUILD state for numpy array');
    }
    const [version, shape, dtype, fortran, raw] = state;
    if (!isIndex(version)) throw new ParseError('Bad BUILD state for numpy array (version)');
    if (!Array.isArray(shape) || shape.length > MAX_NDIM || !shape.every(isIndex)) {
      throw new ParseError('Bad BUILD state for numpy array (shape)');
    }
    if (!(dtype instanceof NumpyDtype))
      throw new ParseError('Bad BUILD state for numpy array (dtype)');
    if (typeof fortran !== 'boolean' && fortran !== 0 && fortran !== 1) {
      throw new ParseError('Bad BUILD state for numpy array (order)');
    }
    this.shape = shape.slice() as number[];
    this.dtype = dtype;
    this.fortran = Boolean(fortran);
    this.raw = raw;
    this.built = true;
  }
}

/**
 * Decode the UTF-8 encoding of latin-1 text straight to bytes (code points 0..255 only),
 * without building a JS string.
 */
export function latin1FromUtf8(view: Uint8Array): Uint8Array {
  const n = view.length;
  const out = new Uint8Array(n);
  let k = 0;
  for (let j = 0; j < n; j++) {
    const b = view[j];
    if (b < 0x80) {
      out[k++] = b;
    } else if ((b === 0xc2 || b === 0xc3) && j + 1 < n && (view[j + 1] & 0xc0) === 0x80) {
      out[k++] = ((b & 0x1f) << 6) | (view[j + 1] & 0x3f);
      j++;
    } else {
      throw new ParseError(`Invalid latin-1 payload at byte ${view.byteOffset + j}`);
    }
  }
  return out.subarray(0, k);
}

/** `_codecs.encode(s, 'latin1')`: never decodes a large payload eagerly. */
export function codecsEncode(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length !== 2)
    throw new ParseError('Bad arguments for _codecs.encode');
  const [s, enc] = args;
  if (enc !== 'latin1' && enc !== 'latin-1') {
    throw new ParseError(`Unsupported codec ${typeof enc === 'string' ? enc.slice(0, 32) : '?'}`);
  }
  if (typeof s === 'string') {
    const out = new Uint8Array(s.length);
    for (let k = 0; k < s.length; k++) {
      const c = s.charCodeAt(k);
      if (c > 0xff) throw new ParseError('Invalid latin-1 text in _codecs.encode');
      out[k] = c;
    }
    return out;
  }
  if (s instanceof LazyBytes) return s.utf8 ? new Latin1Bytes(s) : s;
  throw new ParseError('Bad arguments for _codecs.encode');
}

/** `numpy.dtype(code, align, copy)`. */
export function makeDtype(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length < 1 || typeof args[0] !== 'string') {
    throw new ParseError('Bad arguments for numpy.dtype');
  }
  return new NumpyDtype(args[0]);
}

/** `numpy.core.multiarray._reconstruct(ndarray, (0,), b'b')`: an empty array awaiting BUILD. */
export function reconstruct(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length !== 3) {
    throw new ParseError('Bad arguments for numpy.core.multiarray._reconstruct');
  }
  return new NumpyArray();
}

/** `numpy.core.multiarray.scalar(dtype, raw)` → number (or an inert placeholder for non-numeric dtypes). */
export function makeScalar(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length !== 2 || !(args[0] instanceof NumpyDtype)) {
    throw new ParseError('Bad arguments for numpy.core.multiarray.scalar');
  }
  const [dtype, raw] = args as [NumpyDtype, PyValue];
  if (!dtype.numeric || dtype.bigEndian) return new Placeholder('numpy', 'scalar', args);
  if (!(raw instanceof Uint8Array) || raw.length !== dtype.itemsize) {
    throw new ParseError('Bad arguments for numpy.core.multiarray.scalar');
  }
  const v = bytesToFloat64(raw, dtype.kind, dtype.itemsize, 1)[0];
  return dtype.kind === 'b' ? v !== 0 : v;
}

/** Element count of a shape with overflow checks. */
export function numelOf(shape: readonly number[]): number {
  let n = 1;
  for (const d of shape) {
    n *= d;
    if (!Number.isSafeInteger(n)) throw new ParseError('Array too large');
  }
  return n;
}

/** Throws unless a Float64Array of k elements can be allocated safely. */
export function checkAlloc(k: number): void {
  if (!Number.isSafeInteger(k) || k < 0 || k * 8 > 2 ** 31) throw new ParseError('Array too large');
}

/**
 * Materialize a numeric array's bytes. The only function that reads payload bytes; validates
 * `raw.byteLength === prod(shape) * itemsize`.
 */
export function numpyArrayData(arr: NumpyArray): Uint8Array {
  const dtype = arr.dtype;
  if (!dtype) throw new ParseError('numpy array without dtype');
  if (!dtype.numeric || dtype.bigEndian)
    throw new ParseError(`Unsupported dtype ${dtype.byteOrder}${dtype.code}`);
  if (arr.fortran && arr.shape.length > 1)
    throw new ParseError('Fortran-ordered arrays are not supported');
  const numel = numelOf(arr.shape);
  checkAlloc(numel);
  const expected = numel * dtype.itemsize;
  let bytes: Uint8Array;
  const raw = arr.raw;
  if (raw instanceof Uint8Array) {
    bytes = raw;
  } else if (raw instanceof Latin1Bytes) {
    materializeCount++;
    bytes = latin1FromUtf8(raw.src.view);
  } else if (raw instanceof LazyBytes && !raw.utf8) {
    materializeCount++;
    bytes = raw.view;
  } else {
    throw new ParseError('numpy array has no byte payload');
  }
  if (bytes.byteLength !== expected) {
    throw new ParseError(`numpy array payload has ${bytes.byteLength} bytes, expected ${expected}`);
  }
  return bytes;
}

function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const f = h & 0x3ff;
  if (e === 0) return s * 2 ** -14 * (f / 1024);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * 2 ** (e - 15) * (1 + f / 1024);
}

/**
 * Convert `count` little-endian elements of the given numeric kind/itemsize to a fresh,
 * exactly-sized Float64Array (copies; unaligned input is sliced first).
 */
export function bytesToFloat64(
  bytes: Uint8Array,
  kind: string,
  itemsize: number,
  count: number,
): Float64Array {
  checkAlloc(count);
  if (bytes.byteLength < count * itemsize) throw new ParseError('Array data too short');
  const aligned = bytes.byteOffset % itemsize === 0 ? bytes : bytes.slice(0, count * itemsize);
  const buf = aligned.buffer;
  const off = aligned.byteOffset;
  if (kind === 'f' && itemsize === 8) return new Float64Array(buf, off, count).slice();
  const out = new Float64Array(count);
  let src: ArrayLike<number | bigint>;
  if (kind === 'f' && itemsize === 4) src = new Float32Array(buf, off, count);
  else if (kind === 'f' && itemsize === 2) {
    const h = new Uint16Array(buf, off, count);
    for (let k = 0; k < count; k++) out[k] = halfToFloat(h[k]);
    return out;
  } else if (kind === 'i' && itemsize === 8) src = new BigInt64Array(buf, off, count);
  else if (kind === 'u' && itemsize === 8) src = new BigUint64Array(buf, off, count);
  else if (kind === 'i' && itemsize === 4) src = new Int32Array(buf, off, count);
  else if (kind === 'u' && itemsize === 4) src = new Uint32Array(buf, off, count);
  else if (kind === 'i' && itemsize === 2) src = new Int16Array(buf, off, count);
  else if (kind === 'u' && itemsize === 2) src = new Uint16Array(buf, off, count);
  else if (kind === 'i' && itemsize === 1) src = new Int8Array(buf, off, count);
  else if ((kind === 'u' || kind === 'b') && itemsize === 1) src = new Uint8Array(buf, off, count);
  else throw new ParseError(`Unsupported dtype ${kind}${itemsize}`);
  for (let k = 0; k < count; k++) out[k] = Number(src[k]);
  return out;
}
