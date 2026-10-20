/**
 * The pickle value model shared by pickle.ts, torch.ts, numpy.ts and monty.ts (spec Phase 2
 * "Pickle VM invariants"). No other module defines pickle-value shapes. These classes are for
 * use inside src/loader/ only.
 *
 * Invariants: no pickle-produced value is ever a plain `{}` object; dicts are `Map`s; typed
 * values are recognised only with `instanceof`; nothing is ever called on a value that is not
 * a `Handler`.
 */
import type { LazyTensor, SparseTensor, StorageClass, StorageRef } from './torch';

/** Zero-copy view of a large length-prefixed pickle payload (see "Large inline payloads"). */
export class LazyBytes {
  readonly kind = 'bytes' as const;
  /** `u8.subarray(i, i + n)` of the data.pkl buffer: zero-copy, never sliced. */
  readonly view: Uint8Array;
  /** true for BINUNICODE (UTF-8 text), false for BINSTRING / BINBYTES (raw bytes). */
  readonly utf8: boolean;
  constructor(view: Uint8Array, utf8: boolean) {
    this.view = view;
    this.utf8 = utf8;
    Object.freeze(this);
  }
}

/** Result of `_codecs.encode(lazyUtf8, 'latin1')`; decoded only by `numpyArrayData()`. */
export class Latin1Bytes {
  readonly kind = 'latin1' as const;
  readonly src: LazyBytes;
  constructor(src: LazyBytes) {
    this.src = src;
    Object.freeze(this);
  }
}

export type PyValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | LazyBytes
  | Latin1Bytes
  | PyValue[]
  | PyDict
  | Set<PyValue>
  | Handler
  | ClassRef
  | Placeholder
  | Buildable
  | StorageClass
  | StorageRef
  | LazyTensor
  | SparseTensor;

export type PyDict = Map<PyValue, PyValue>;

/** A callable global, created only by findClass's switch. */
export class Handler {
  readonly qname: string;
  readonly invoke: (args: PyValue) => PyValue;
  readonly construct: ((args: PyValue) => PyValue) | undefined;
  constructor(
    qname: string,
    invoke: (args: PyValue) => PyValue,
    construct?: (args: PyValue) => PyValue,
  ) {
    this.qname = qname;
    this.invoke = invoke;
    this.construct = construct;
    Object.freeze(this);
  }
}

/** An unknown global: inert token. */
export class ClassRef {
  readonly module: string;
  readonly name: string;
  constructor(module: string, name: string) {
    this.module = module;
    this.name = name;
    Object.freeze(this);
  }
}

/** Instance of an unknown class (REDUCE/NEWOBJ on a ClassRef or on a non-callable). */
export class Placeholder {
  /** Set once by BUILD; never merged into the object. */
  state: PyValue | undefined = undefined;
  readonly module: string;
  readonly name: string;
  readonly args: PyValue;
  constructor(module: string, name: string, args: PyValue) {
    this.module = module;
    this.name = name;
    this.args = Array.isArray(args) ? (Object.freeze(args.slice()) as PyValue[]) : args;
  }
}

/** Objects created by handlers whose BUILD state is validated (NumpyDtype, NumpyArray). */
export abstract class Buildable {
  abstract setState(state: PyValue): void;
}

/** Read an attribute of a pickled object or a key of a pickled dict. */
export function own(v: PyValue | undefined, field: string): PyValue | undefined {
  if (v instanceof Map) return v.get(field);
  if (v instanceof Placeholder) {
    const s = v.state;
    if (s instanceof Map) return s.get(field);
    if (Array.isArray(s) && s.length === 2) {
      // (__dict__, slots) state
      const [d, slots] = s;
      if (d instanceof Map && d.has(field)) return d.get(field);
      if (slots instanceof Map) return slots.get(field);
    }
  }
  return undefined;
}

export const isLazyBytes = (v: unknown): v is LazyBytes => v instanceof LazyBytes;
export const isLatin1Bytes = (v: unknown): v is Latin1Bytes => v instanceof Latin1Bytes;

/** Safe non-negative integer test used by every handler argument check. */
export const isIndex = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
