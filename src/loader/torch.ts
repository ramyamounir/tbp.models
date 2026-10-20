/**
 * torch reconstruction and the closed `findClass` table (spec Phase 2 "findClass table",
 * "persistent_load", "Pickle VM invariants" rule 1, "Bounds and validation").
 *
 * Tensors are lazy: `_rebuild_tensor_v2` only validates and records the storage reference;
 * storage bytes are read from the zip later (parse.ts) and only for graph arrays.
 */
import { ParseError } from './errors';
import { checkAlloc, codecsEncode, makeDtype, makeScalar, numelOf, reconstruct } from './numpy';
import { ClassRef, Handler, isIndex, type PyValue } from './pyvalue';

export type StorageDtype = 'f4' | 'f8' | 'i8' | 'i4' | 'i2' | 'u1' | 'b1' | 'f2';

/** `torch.<X>Storage` global (not a Handler; only usable inside a persistent id). */
export class StorageClass {
  readonly name: string;
  readonly dtype: StorageDtype;
  readonly bytesPerElement: number;
  constructor(name: string, dtype: StorageDtype, bytesPerElement: number) {
    this.name = name;
    this.dtype = dtype;
    this.bytesPerElement = bytesPerElement;
    Object.freeze(this);
  }
  get kind(): string {
    return this.dtype[0];
  }
}

const STORAGE_CLASSES = {
  FloatStorage: new StorageClass('FloatStorage', 'f4', 4),
  DoubleStorage: new StorageClass('DoubleStorage', 'f8', 8),
  LongStorage: new StorageClass('LongStorage', 'i8', 8),
  IntStorage: new StorageClass('IntStorage', 'i4', 4),
  ShortStorage: new StorageClass('ShortStorage', 'i2', 2),
  ByteStorage: new StorageClass('ByteStorage', 'u1', 1),
  BoolStorage: new StorageClass('BoolStorage', 'b1', 1),
  HalfStorage: new StorageClass('HalfStorage', 'f2', 2),
} as const;

export const STORAGE_KEY_RE = /^[A-Za-z0-9_.-]+$/;

/** A storage referenced by a persistent id; `bytes` is filled by parse.ts before graphs are built. */
export class StorageRef {
  bytes: Uint8Array | undefined = undefined;
  readonly cls: StorageClass;
  readonly key: string;
  readonly numel: number;
  constructor(cls: StorageClass, key: string, numel: number) {
    this.cls = cls;
    this.key = key;
    this.numel = numel;
  }
  get byteLength(): number {
    return this.numel * this.cls.bytesPerElement;
  }
}

/**
 * A tensor view `storage[offset : offset + numel]` with `shape`. Non-contiguous tensors (e.g. the
 * COO index tensors of sparse voxel grids, which Monty never needs) are accepted when built but
 * cannot be read: `data()` throws `ParseError('Non-contiguous tensor')`, so only a graph array
 * that is non-contiguous fails (and only that graph becomes unreadable).
 */
export class LazyTensor {
  readonly numel: number;
  readonly storage: StorageRef;
  readonly offset: number;
  readonly shape: readonly number[];
  readonly contiguous: boolean;
  constructor(storage: StorageRef, offset: number, shape: readonly number[], contiguous = true) {
    this.storage = storage;
    this.offset = offset;
    this.shape = shape;
    this.numel = numelOf(shape);
    this.contiguous = contiguous;
    Object.freeze(this);
  }
  /** Bytes of this tensor (little-endian); requires the storage bytes to be loaded. */
  data(): Uint8Array {
    if (!this.contiguous) throw new ParseError('Non-contiguous tensor');
    const s = this.storage;
    if (!s.bytes) throw new ParseError(`Tensor storage ${s.key} was not loaded`);
    if (this.offset + this.numel > s.numel || s.bytes.byteLength !== s.byteLength) {
      throw new ParseError(`Tensor storage ${s.key} is too short`);
    }
    const bpe = s.cls.bytesPerElement;
    return s.bytes.subarray(this.offset * bpe, (this.offset + this.numel) * bpe);
  }
}

/** Sparse tensors (voxel grids) are never read. */
export class SparseTensor {
  constructor() {
    Object.freeze(this);
  }
}

const MAX_TENSOR_NDIM = 8;

function rebuildTensorV2(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length < 4)
    throw new ParseError('Bad arguments for torch._utils._rebuild_tensor_v2');
  const [storage, offset, size, stride] = args;
  if (
    !(storage instanceof StorageRef) ||
    !isIndex(offset) ||
    !Array.isArray(size) ||
    !Array.isArray(stride) ||
    size.length !== stride.length ||
    size.length > MAX_TENSOR_NDIM ||
    !size.every(isIndex) ||
    !stride.every(isIndex)
  ) {
    throw new ParseError('Bad arguments for torch._utils._rebuild_tensor_v2');
  }
  const shape = size as number[];
  const numel = numelOf(shape);
  checkAlloc(numel);
  // Contiguous row-major strides; dimensions of size 1 may have any stride. Non-contiguous tensors
  // are only rejected when read (LazyTensor.data), since local files contain some on non-graph paths.
  let expected = 1;
  let contiguous = true;
  let extent = 0; // largest element index reachable from offset (Σ (size−1)·stride)
  for (let k = shape.length - 1; k >= 0; k--) {
    if (shape[k] !== 1 && stride[k] !== expected) contiguous = false;
    expected *= shape[k];
    if (shape[k] > 0) {
      extent += (shape[k] - 1) * (stride[k] as number);
      if (!Number.isSafeInteger(extent)) throw new ParseError('Array too large');
    }
  }
  if (
    offset > storage.numel ||
    (numel > 0 && (offset + extent >= storage.numel || offset + numel > storage.numel))
  ) {
    throw new ParseError(`Tensor exceeds its storage ${storage.key}`);
  }
  return new LazyTensor(storage, offset, shape, contiguous);
}

function identity(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length !== 1) throw new ParseError('Bad arguments');
  return args[0];
}

function makeDict(args: PyValue): PyValue {
  const m = new Map<PyValue, PyValue>();
  if (!Array.isArray(args) || args.length > 1) throw new ParseError('Bad arguments for dict');
  if (args.length === 1) {
    const pairs = args[0];
    if (!Array.isArray(pairs)) throw new ParseError('Bad arguments for dict');
    for (const p of pairs) {
      if (!Array.isArray(p) || p.length !== 2) throw new ParseError('Bad arguments for dict');
      m.set(p[0], p[1]);
    }
  }
  return m;
}

function makeDefaultDict(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length > 1)
    throw new ParseError('Bad arguments for collections.defaultdict');
  return new Map<PyValue, PyValue>();
}

function makeSet(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length > 1) throw new ParseError('Bad arguments for set');
  if (args.length === 0) return new Set<PyValue>();
  if (!Array.isArray(args[0])) throw new ParseError('Bad arguments for set');
  return new Set<PyValue>(args[0]);
}

function makeList(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length > 1) throw new ParseError('Bad arguments for list');
  if (args.length === 0) return [];
  if (!Array.isArray(args[0])) throw new ParseError('Bad arguments for list');
  return args[0].slice();
}

function makeInt(args: PyValue): PyValue {
  if (!Array.isArray(args) || args.length < 1) throw new ParseError('Bad arguments for int');
  const v = args[0];
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) throw new ParseError('Bad arguments for int');
  return Math.trunc(n);
}

function makeBytes(args: PyValue): PyValue {
  if (!Array.isArray(args)) throw new ParseError('Bad arguments for bytes');
  if (args.length === 0) return new Uint8Array(0);
  return codecsEncode(args);
}

const H = (qname: string, fn: (args: PyValue) => PyValue) => new Handler(qname, fn);

// Handlers are created once (frozen) and shared.
const HANDLERS = {
  rebuildTensor: H('torch._utils._rebuild_tensor_v2', rebuildTensorV2),
  rebuildSparse: H('torch._utils._rebuild_sparse_tensor', () => new SparseTensor()),
  getLayout: H('torch.serialization._get_layout', identity),
  torchSize: H('torch.Size', identity),
  dict: H('builtins.dict', makeDict),
  orderedDict: H('collections.OrderedDict', makeDict),
  defaultDict: H('collections.defaultdict', makeDefaultDict),
  set: H('builtins.set', makeSet),
  list: H('builtins.list', makeList),
  int: H('builtins.int', makeInt),
  bytes: H('builtins.bytes', makeBytes),
  codecsEncode: H('_codecs.encode', codecsEncode),
  dtype: H('numpy.dtype', makeDtype),
  reconstruct: H('numpy.core.multiarray._reconstruct', reconstruct),
  scalar: H('numpy.core.multiarray.scalar', makeScalar),
};

/**
 * Closed class table: a switch over the exact `module.name`; everything else is an inert
 * `ClassRef` (REDUCE/NEWOBJ turn it into a `Placeholder`).
 */
export function findClass(module: string, name: string): PyValue {
  switch (`${module}.${name}`) {
    case 'torch._utils._rebuild_tensor_v2':
      return HANDLERS.rebuildTensor;
    case 'torch._utils._rebuild_sparse_tensor':
      return HANDLERS.rebuildSparse;
    case 'torch.serialization._get_layout':
      return HANDLERS.getLayout;
    case 'torch.Size':
      return HANDLERS.torchSize;
    case 'torch.FloatStorage':
      return STORAGE_CLASSES.FloatStorage;
    case 'torch.DoubleStorage':
      return STORAGE_CLASSES.DoubleStorage;
    case 'torch.LongStorage':
      return STORAGE_CLASSES.LongStorage;
    case 'torch.IntStorage':
      return STORAGE_CLASSES.IntStorage;
    case 'torch.ShortStorage':
      return STORAGE_CLASSES.ShortStorage;
    case 'torch.ByteStorage':
      return STORAGE_CLASSES.ByteStorage;
    case 'torch.BoolStorage':
      return STORAGE_CLASSES.BoolStorage;
    case 'torch.HalfStorage':
      return STORAGE_CLASSES.HalfStorage;
    case 'collections.OrderedDict':
      return HANDLERS.orderedDict;
    case '__builtin__.dict':
    case 'builtins.dict':
      return HANDLERS.dict;
    case 'collections.defaultdict':
      return HANDLERS.defaultDict;
    case '__builtin__.set':
    case 'builtins.set':
      return HANDLERS.set;
    case '__builtin__.list':
    case 'builtins.list':
      return HANDLERS.list;
    case '__builtin__.long':
    case 'builtins.int':
      return HANDLERS.int;
    case '__builtin__.bytes':
    case 'builtins.bytes':
      return HANDLERS.bytes;
    case '_codecs.encode':
      return HANDLERS.codecsEncode;
    case 'numpy.dtype':
      return HANDLERS.dtype;
    case 'numpy.core.multiarray._reconstruct':
    case 'numpy._core.multiarray._reconstruct':
      return HANDLERS.reconstruct;
    case 'numpy.core.multiarray.scalar':
    case 'numpy._core.multiarray.scalar':
      return HANDLERS.scalar;
    default:
      return new ClassRef(module, name);
  }
}

/**
 * persistent_load for `('storage', <StorageClass>, key, location, numel)`. Records every
 * storage in `storages` (keyed by storage key) so parse.ts can read the ones graphs use.
 */
export function makePersistentLoad(storages: Map<string, StorageRef>): (pid: PyValue) => PyValue {
  return (pid) => {
    if (!Array.isArray(pid) || pid.length !== 5 || pid[0] !== 'storage') {
      throw new ParseError('Bad persistent id');
    }
    const [, cls, key, , numel] = pid;
    if (!(cls instanceof StorageClass)) throw new ParseError('Bad persistent id (storage type)');
    if (typeof key !== 'string' || !STORAGE_KEY_RE.test(key))
      throw new ParseError('Bad persistent id (key)');
    if (!isIndex(numel)) throw new ParseError('Bad persistent id (numel)');
    const prev = storages.get(key);
    if (prev) {
      if (prev.cls !== cls || prev.numel !== numel)
        throw new ParseError(`Conflicting storage ${key}`);
      return prev;
    }
    const ref = new StorageRef(cls, key, numel);
    storages.set(key, ref);
    return ref;
  };
}
