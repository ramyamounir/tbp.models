/**
 * Monty structures in the lossless pickle tree (spec multi-file-edit-diff Phase 4b "Tree editing
 * rules", "Monty structures in the tree").
 *
 * Parsed source trees are read-only for the whole export: `indexSource` builds a pristine index
 * of each source once, and `rebuildDestination` produces a new destination tree made of fresh
 * container nodes. Graph subtrees are shared when nothing in them changes on their first own-file
 * use, and deep-cloned (`cloneSubtree`, preserving sharing and cycles) otherwise. Edits are only
 * made on nodes the rebuild owns. Every traversal is iterative with an identity visited set.
 */
import type { GraphOrigin, ObjectIdPatch } from '../model/types';
import { latin1FromUtf8, parseDtype, type ExportDtype } from '../loader/numpy';
import { STORAGE_KEY_RE } from '../loader/torch';
import { roundedObjectId } from '../edit/references';
import {
  attr,
  attrPair,
  canonKey,
  decodeText,
  dictGet,
  dictPair,
  dictPairs,
  forEachChild,
  intValue,
  isGlobal,
  longValue,
  payloadBytes,
  strValue,
} from './astWalk';
import { ExportError } from './errors';
import type { ExportManifest, ManifestGraph } from './manifest';
import { NONE_NODE, type PickleAst, type PNode, type PObj } from './pickleAst';

// ---------------------------------------------------------------------------------------------
// Source index
// ---------------------------------------------------------------------------------------------

export interface SourceEntry {
  /** The graph_memory key node, as parsed. */
  key: PNode;
  /** The graph subtree (channel dict), as parsed. */
  value: PNode;
  /** On-disk graph id: the decoded `str` value of `key` (the loader's key label for other kinds). */
  name: string;
}

export interface SourceLm {
  /** lm_dict[lmId] dict node, as parsed. */
  shell: PNode;
  /** graph_memory items in item order; origin.entry indexes this array. */
  entries: SourceEntry[];
  /** graph_id_to_target: key (see `targetLookupKey`) -> pristine set node. */
  idToTarget: Map<string, PNode>;
}

export interface StorageRef {
  /** `${module}.${name}` of the storage-class global, e.g. 'torch.FloatStorage'. */
  cls: string;
  /** Decoded location str of the first use, e.g. 'cpu'. */
  location: string;
  /** Element count. */
  numel: number;
}

export interface SourceIndex {
  fileId: string;
  fileName: string;
  /** The parsed root dict. */
  root: PNode;
  /** Keyed by the lm_dict int key. */
  lms: Map<number, SourceLm>;
  /** Every persid storage key used in this tree -> its validated class / numel. */
  storages: Map<string, StorageRef>;
}

/** Loader-style label of a graph_memory key (display / name comparison only). */
function keyName(k: PNode): string {
  const s = strValue(k);
  if (s !== undefined) return s;
  switch (k.t) {
    case 'int':
    case 'bool':
    case 'float':
      return String(k.v);
    case 'long':
      return longValue(k.raw).toString();
    case 'none':
      return 'null';
    default:
      return '<non-string key>';
  }
}

/** Key under which `idToTarget` stores (and is looked up for) a graph_memory key node. */
export function targetLookupKey(k: PNode): string {
  const s = strValue(k);
  if (s !== undefined) return s;
  return `\u0000${canonKey(k) ?? keyName(k)}`;
}

function pyRepr(s: string): string {
  const shown = s.length > 64 ? `${s.slice(0, 64)}…` : s;
  return `'${shown}'`;
}

function checkDuplicateKeys(
  pairs: readonly [PNode, PNode][],
  fileName: string,
  path: string,
): void {
  const seen = new Set<string>();
  const seenNodes = new Set<PNode>();
  for (const [k] of pairs) {
    const c = canonKey(k);
    if (c === undefined) {
      if (seenNodes.has(k)) dup();
      seenNodes.add(k);
      continue;
    }
    if (seen.has(c)) dup();
    seen.add(c);
  }
  function dup(): never {
    throw new ExportError(`${fileName} has duplicate keys in ${path}; it cannot be exported`);
  }
}

function storageError(fileName: string, reason: string): ExportError {
  return new ExportError(
    `${fileName} has an unsupported tensor storage reference (${reason}); it cannot be exported`,
  );
}

const MAX_KEY_SHOWN = 64;
const trunc = (s: string) => (s.length > MAX_KEY_SHOWN ? s.slice(0, MAX_KEY_SHOWN) : s);

/** Validates one persid node (spec "Storage-reference validation"); returns its key and ref. */
function validatePersid(
  n: Extract<PNode, { t: 'persid' }>,
  fileName: string,
): { key: string; ref: StorageRef } {
  const pid = n.pid;
  if (pid.t !== 'tuple' || pid.items.length !== 5) {
    throw storageError(fileName, 'not a 5-item storage tuple');
  }
  const [tag, cls, keyNode, locNode, numelNode] = pid.items;
  if (tag.t !== 'str' || decodeText(tag.v) !== 'storage') {
    throw storageError(fileName, 'not a 5-item storage tuple');
  }
  if (cls.t !== 'global' || cls.module !== 'torch' || !cls.name.endsWith('Storage')) {
    const shown = cls.t === 'global' ? `${cls.module}.${cls.name}` : cls.t;
    throw storageError(fileName, `storage class ${shown}`);
  }
  if (keyNode.t !== 'str') throw storageError(fileName, `storage key ${keyNode.t}`);
  const key = decodeText(keyNode.v);
  if (key.length > 64 || !STORAGE_KEY_RE.test(key)) {
    throw storageError(fileName, `storage key ${trunc(key)}`);
  }
  if (locNode.t !== 'str') throw storageError(fileName, 'not a 5-item storage tuple');
  let numel: number | undefined;
  if (numelNode.t === 'int' && numelNode.v >= 0) numel = numelNode.v;
  else if (numelNode.t === 'long') {
    const b = longValue(numelNode.raw);
    if (b >= 0n && b <= BigInt(Number.MAX_SAFE_INTEGER)) numel = Number(b);
  }
  if (numel === undefined) throw storageError(fileName, 'numel');
  return {
    key,
    ref: { cls: `${cls.module}.${cls.name}`, location: decodeText(locNode.v), numel },
  };
}

/**
 * Read-only index of one parsed source tree: LM shells, pristine graph_memory entries, target
 * sets, the duplicate-key check and the validation of every tensor storage reference.
 */
export function indexSource(fileId: string, fileName: string, ast: PickleAst): SourceIndex {
  const changed = () =>
    new ExportError(`${fileName} changed since it was opened; reopen it and export again`);
  const root = ast.root;
  const lmPairs = dictPairs(dictGet(root, 'lm_dict'));
  if (!lmPairs) throw changed();
  checkDuplicateKeys(lmPairs, fileName, 'lm_dict');
  const lms = new Map<number, SourceLm>();
  for (const [k, shell] of lmPairs) {
    const lmId = intValue(k);
    if (lmId === undefined || lmId < 0) throw changed();
    if (shell.t !== 'dict') {
      throw new ExportError(
        `${fileName} has lm_dict[${lmId}] in an unsupported form; it cannot be exported`,
      );
    }
    const gmPairs = dictPairs(attr(shell, 'graph_memory'));
    if (!gmPairs) throw changed();
    const base = `lm_dict[${lmId}]`;
    checkDuplicateKeys(gmPairs, fileName, `${base}['graph_memory']`);
    const entries: SourceEntry[] = [];
    for (const [key, value] of gmPairs) {
      const name = keyName(key);
      const channels = dictPairs(value);
      if (channels) {
        checkDuplicateKeys(channels, fileName, `${base}['graph_memory'][${pyRepr(name)}]`);
      }
      entries.push({ key, value, name });
    }
    const idToTarget = new Map<string, PNode>();
    const g2t = dictPairs(attr(shell, 'graph_id_to_target'));
    if (g2t) {
      checkDuplicateKeys(g2t, fileName, `${base}['graph_id_to_target']`);
      for (const [gk, set] of g2t) {
        const lk = targetLookupKey(gk);
        if (!idToTarget.has(lk)) idToTarget.set(lk, set);
      }
    }
    const t2g = dictPairs(attr(shell, 'target_to_graph_id'));
    if (t2g) checkDuplicateKeys(t2g, fileName, `${base}['target_to_graph_id']`);
    lms.set(lmId, { shell, entries, idToTarget });
  }

  // Storage references: walk the whole tree once.
  const storages = new Map<string, StorageRef>();
  const visited = new Set<PNode>();
  const stack: PNode[] = [root];
  const visit = (c: PNode) => {
    if (!visited.has(c)) {
      visited.add(c);
      stack.push(c);
    }
  };
  visited.add(root);
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.t === 'persid') {
      const { key, ref } = validatePersid(n, fileName);
      const prev = storages.get(key);
      if (!prev) storages.set(key, ref);
      else if (prev.cls !== ref.cls || prev.numel !== ref.numel) {
        throw storageError(fileName, `key ${trunc(key)} used with different class or size`);
      }
    }
    forEachChild(n, visit);
  }
  return { fileId, fileName, root, lms, storages };
}

// ---------------------------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------------------------

export interface StorageKeyAllocator {
  next(): string;
}

/** Export-wide allocator of new storage keys that never collide with the destination's. */
export function createStorageKeyAllocator(
  destIndex: SourceIndex,
  destEntryNames: readonly string[],
  prefix: string,
): StorageKeyAllocator {
  const head = `${prefix}/data/`;
  const names = new Set(destEntryNames);
  const candidates: string[] = [...destIndex.storages.keys()];
  for (const name of destEntryNames) {
    if (name.startsWith(head)) {
      const k = name.slice(head.length);
      if (k !== '' && !k.includes('/')) candidates.push(k);
    }
  }
  let counter = 0;
  for (const k of candidates) {
    if (/^\d{1,15}$/.test(k)) counter = Math.max(counter, Number(k) + 1);
  }
  return {
    next(): string {
      for (;;) {
        const v = String(counter++);
        if (names.has(`${head}${v}`) || destIndex.storages.has(v)) continue;
        return v;
      }
    },
  };
}

/** newKey -> the storage it copies (source file id and its key there). */
export type StorageRemap = Map<string, { fileId: string; oldKey: string }>;

// ---------------------------------------------------------------------------------------------
// Subtree clone
// ---------------------------------------------------------------------------------------------

export interface CloneOptions {
  remapStorages: boolean;
  /** Source file of the subtree (storage remapping only). */
  fileId?: string;
  remap?: StorageRemap;
  alloc?: StorageKeyAllocator;
  /** Nodes returned as themselves and not descended into. */
  keep?: ReadonlySet<PNode>;
}

/**
 * Deep copy of `node` preserving sharing and cycles inside the subtree (identity map, copy shell
 * registered before its children are filled, explicit stack). `none` / `bool` singletons,
 * numeric atoms, `global` nodes and `keep` nodes are shared. With `remapStorages`, every storage
 * key gets a new key from the allocator (one per distinct old key per call).
 */
export function cloneSubtree(node: PNode, opts: CloneOptions): PNode {
  const map = new Map<PNode, PNode>();
  const keyMap = new Map<string, string>();
  const fill: [PNode, PNode][] = [];
  const copyOf = (n: PNode): PNode => {
    switch (n.t) {
      case 'none':
      case 'bool':
      case 'int':
      case 'long':
      case 'float':
      case 'global':
        return n;
      default:
        break;
    }
    if (opts.keep?.has(n)) return n;
    const got = map.get(n);
    if (got) return got;
    let shell: PNode;
    switch (n.t) {
      case 'str':
        shell = { t: 'str', v: n.v };
        break;
      case 'bstr':
        shell = { t: 'bstr', v: n.v };
        break;
      case 'bytes':
        shell = { t: 'bytes', v: n.v };
        break;
      case 'tuple':
        shell = { t: 'tuple', items: [] };
        break;
      case 'list':
        shell = { t: 'list', items: [] };
        break;
      case 'dict':
        shell = { t: 'dict', items: [] };
        break;
      case 'obj':
        shell = { t: 'obj', via: n.via, fn: NONE_NODE, args: NONE_NODE };
        break;
      case 'persid':
        shell = { t: 'persid', pid: NONE_NODE };
        break;
    }
    map.set(n, shell);
    if (n.t !== 'str' && n.t !== 'bstr' && n.t !== 'bytes') fill.push([n, shell]);
    return shell;
  };
  const root = copyOf(node);
  while (fill.length > 0) {
    const [n, s] = fill.pop()!;
    switch (n.t) {
      case 'tuple':
      case 'list': {
        const items = (s as { items: PNode[] }).items;
        for (const c of n.items) items.push(copyOf(c));
        break;
      }
      case 'dict': {
        const items = (s as Extract<PNode, { t: 'dict' }>).items;
        for (const [k, v] of n.items) items.push([copyOf(k), copyOf(v)]);
        break;
      }
      case 'obj': {
        const o = s as PObj;
        o.fn = copyOf(n.fn);
        o.args = copyOf(n.args);
        if (n.state !== undefined) o.state = copyOf(n.state);
        if (n.listItems) o.listItems = n.listItems.map(copyOf);
        if (n.dictItems) o.dictItems = n.dictItems.map(([k, v]) => [copyOf(k), copyOf(v)]);
        break;
      }
      case 'persid': {
        const p = s as Extract<PNode, { t: 'persid' }>;
        if (opts.remapStorages && n.pid.t === 'tuple' && n.pid.items.length === 5) {
          const [tag, cls, keyNode, loc, numel] = n.pid.items;
          const oldKey = strValue(keyNode) ?? '';
          const mapKey = `${opts.fileId ?? ''}\u0000${oldKey}`;
          let newKey = keyMap.get(mapKey);
          if (newKey === undefined) {
            if (!opts.alloc || !opts.remap)
              throw new ExportError('internal: storage remap without allocator');
            newKey = opts.alloc.next();
            keyMap.set(mapKey, newKey);
            opts.remap.set(newKey, { fileId: opts.fileId ?? '', oldKey });
          }
          p.pid = { t: 'tuple', items: [tag, cls, { t: 'str', v: newKey }, loc, numel] };
        } else {
          p.pid = copyOf(n.pid);
        }
        break;
      }
      default:
        break;
    }
  }
  return root;
}

// ---------------------------------------------------------------------------------------------
// Graph fields
// ---------------------------------------------------------------------------------------------

/** Where a channel's graph data lives. `fields` is the dict node that holds the `x` item. */
export interface GraphFields {
  fields: PNode;
  x: PNode;
  featureMapping: PNode;
}

/** The dict node `attr` reads an obj's attributes from (state dict, or `(dict, slots)` dict). */
function attrDictOf(n: PNode, name: string): PNode | undefined {
  if (n.t === 'dict') return n;
  if (n.t !== 'obj') return undefined;
  const s = n.state;
  if (s?.t === 'dict') return s;
  if (s?.t === 'tuple' && s.items.length === 2) {
    for (const d of s.items) if (d.t === 'dict' && dictPair(d, name)) return d;
  }
  if (n.dictItems) return n;
  return undefined;
}

/** `_graph` fields of a channel's object model (current NumpyGraph or legacy `_store._mapping`). */
export function graphFields(objModel: PNode): GraphFields | undefined {
  const g = attr(objModel, '_graph');
  if (!g) return undefined;
  const store = attr(g, '_store');
  let fields: PNode | undefined;
  if (store !== undefined) {
    fields = attr(store, '_mapping');
    if (!fields || fields.t !== 'dict') return undefined;
  } else {
    fields = attrDictOf(g, 'x');
  }
  if (!fields) return undefined;
  const x = dictGet(fields, 'x');
  const featureMapping = dictGet(fields, 'feature_mapping');
  if (!x || !featureMapping) return undefined;
  return { fields, x, featureMapping };
}

// ---------------------------------------------------------------------------------------------
// object_id patches
// ---------------------------------------------------------------------------------------------

class PatchFailure extends Error {}

const fail = (reason: string): never => {
  throw new PatchFailure(reason);
};

const INT_RANGE: Record<string, [number, number]> = {
  i1: [-128, 127],
  u1: [0, 255],
  i2: [-32768, 32767],
  u2: [0, 65535],
  i4: [-(2 ** 31), 2 ** 31 - 1],
  u4: [0, 2 ** 32 - 1],
  i8: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  u8: [0, Number.MAX_SAFE_INTEGER],
};

const typeName = (t: ExportDtype) => `${t.kind}${t.size}`;

function checkRepresentable(to: number, t: ExportDtype): void {
  let ok: boolean;
  if (t.kind === 'f') {
    ok = Number.isInteger(to) && Math.abs(to) <= (t.size === 4 ? 2 ** 24 : 2 ** 53);
  } else {
    const [lo, hi] = INT_RANGE[typeName(t)];
    ok = Number.isInteger(to) && to >= lo && to <= hi;
  }
  if (!ok) fail(`id ${to} does not fit ${typeName(t)}`);
}

function getEl(dv: DataView, off: number, t: ExportDtype): number {
  const le = t.littleEndian;
  switch (`${t.kind}${t.size}`) {
    case 'f4':
      return dv.getFloat32(off, le);
    case 'f8':
      return dv.getFloat64(off, le);
    case 'i1':
      return dv.getInt8(off);
    case 'u1':
      return dv.getUint8(off);
    case 'i2':
      return dv.getInt16(off, le);
    case 'u2':
      return dv.getUint16(off, le);
    case 'i4':
      return dv.getInt32(off, le);
    case 'u4':
      return dv.getUint32(off, le);
    case 'i8':
      return Number(dv.getBigInt64(off, le));
    case 'u8':
      return Number(dv.getBigUint64(off, le));
  }
  return NaN;
}

function setEl(dv: DataView, off: number, t: ExportDtype, v: number): void {
  const le = t.littleEndian;
  switch (`${t.kind}${t.size}`) {
    case 'f4':
      return dv.setFloat32(off, v, le);
    case 'f8':
      return dv.setFloat64(off, v, le);
    case 'i1':
      return dv.setInt8(off, v);
    case 'u1':
      return dv.setUint8(off, v);
    case 'i2':
      return dv.setInt16(off, v, le);
    case 'u2':
      return dv.setUint16(off, v, le);
    case 'i4':
      return dv.setInt32(off, v, le);
    case 'u4':
      return dv.setUint32(off, v, le);
    case 'i8':
      return dv.setBigInt64(off, BigInt(v), le);
    case 'u8':
      return dv.setBigUint64(off, BigInt(v), le);
  }
}

/**
 * Rewrites column `col` of rows `0..N-1` (`elementIndex(r)` = element index of row r's column)
 * in `buf`. Float values match by the view's rounding rule, integer values exactly.
 */
function applyPatches(
  buf: Uint8Array,
  t: ExportDtype,
  rows: number,
  elementIndex: (r: number) => number,
  patches: readonly ObjectIdPatch[],
): void {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (const p of patches) {
    checkRepresentable(p.to, t);
    for (let r = 0; r < rows; r++) {
      const off = elementIndex(r) * t.size;
      const v = getEl(dv, off, t);
      const match = t.kind === 'f' ? roundedObjectId(v) === p.from : v === p.from;
      if (match) setEl(dv, off, t, p.to);
    }
  }
}

/** `[start, end)` of feature `object_id`, which must be one column inside `[0, F)`. */
function objectIdColumn(featureMapping: PNode, F: number): number {
  const range = dictGet(featureMapping, 'object_id');
  if (!range || (range.t !== 'list' && range.t !== 'tuple')) fail('no x / feature_mapping found');
  const items = (range as { items: PNode[] }).items;
  const start = intValue(items[0]);
  const end = intValue(items[1]);
  if (items.length !== 2 || start === undefined || end === undefined) {
    fail('no x / feature_mapping found');
  }
  if (end! - start! !== 1 || start! < 0 || start! >= F) {
    fail(`object_id column ${start}..${end} not a single column`);
  }
  return start!;
}

function shape2(n: PNode | undefined): [number, number] {
  if (!n || n.t !== 'tuple' || n.items.length !== 2) fail('x is not 2-D');
  const [a, b] = (n as { items: PNode[] }).items.map(intValue);
  if (a === undefined || b === undefined || a < 0 || b < 0) fail('x is not 2-D');
  return [a!, b!];
}

const RECONSTRUCT = new Set(['numpy.core.multiarray', 'numpy._core.multiarray']);

function isNumpyArray(n: PNode): n is PObj {
  return (
    n.t === 'obj' &&
    n.fn.t === 'global' &&
    RECONSTRUCT.has(n.fn.module) &&
    n.fn.name === '_reconstruct'
  );
}

function isTorchTensor(n: PNode): n is PObj {
  return n.t === 'obj' && isGlobal(n.fn, 'torch._utils', '_rebuild_tensor_v2');
}

function latin1String(u8: Uint8Array): string {
  let s = '';
  for (let k = 0; k < u8.length; k += 8192) {
    s += String.fromCharCode(...u8.subarray(k, Math.min(u8.length, k + 8192)));
  }
  return s;
}

/** Decoded payload of a numpy data node and a function re-encoding new bytes in the same form. */
function numpyData(data: PNode): { bytes: Uint8Array; encode(b: Uint8Array): PNode } {
  if (data.t === 'bytes' || data.t === 'bstr') {
    const t = data.t;
    return { bytes: payloadBytes(data.v).slice(), encode: (b) => ({ t, v: b }) };
  }
  if (data.t === 'obj' && isGlobal(data.fn, '_codecs', 'encode') && data.args.t === 'tuple') {
    const [s, enc] = data.args.items;
    const encName = strValue(enc);
    if (s?.t === 'str' && (encName === 'latin1' || encName === 'latin-1')) {
      let bytes: Uint8Array;
      if (typeof s.v === 'string') {
        bytes = new Uint8Array(s.v.length);
        for (let k = 0; k < s.v.length; k++) {
          const c = s.v.charCodeAt(k);
          if (c > 0xff) fail('unsupported dtype latin-1 payload');
          bytes[k] = c;
        }
      } else {
        bytes = latin1FromUtf8(s.v.view).slice();
      }
      const args = data.args;
      return {
        bytes,
        encode: (b) => ({
          ...data,
          args: { t: 'tuple', items: [{ t: 'str', v: latin1String(b) }, ...args.items.slice(1)] },
        }),
      };
    }
  }
  return fail('unsupported dtype payload');
}

function dtypeOf(node: PNode | undefined): { t: ExportDtype | undefined; descr: string } {
  if (
    !node ||
    node.t !== 'obj' ||
    !isGlobal(node.fn, 'numpy', 'dtype') ||
    node.args.t !== 'tuple'
  ) {
    return { t: undefined, descr: node?.t ?? '?' };
  }
  const code = strValue(node.args.items[0]) ?? '?';
  let order = '=';
  if (node.state?.t === 'tuple' && node.state.items.length >= 2) {
    order = strValue(node.state.items[1]) ?? '?';
  }
  return { t: parseDtype(code, order), descr: `${order}${code}` };
}

/** New numpy array node with patched `x` (pristine read, clone-owned result). */
function patchNumpy(xClone: PObj, xPristine: PObj, fm: PNode, patches: ObjectIdPatch[]): PNode {
  const st = xPristine.state;
  if (!st || st.t !== 'tuple' || st.items.length !== 5) fail('no x / feature_mapping found');
  const [, shapeN, dtypeN, fortranN, dataN] = (st as { items: PNode[] }).items;
  const [N, F] = shape2(shapeN);
  const { t, descr } = dtypeOf(dtypeN);
  if (!t) fail(`unsupported dtype ${descr}`);
  const fortranFalse =
    (fortranN.t === 'bool' && fortranN.v === false) || (fortranN.t === 'int' && fortranN.v === 0);
  if (!fortranFalse) fail('Fortran-order array');
  const col = objectIdColumn(fm, F);
  const { bytes, encode } = numpyData(dataN);
  if (bytes.length !== N * F * t!.size) fail('x is not 2-D');
  applyPatches(bytes, t!, N, (r) => r * F + col, patches);
  const cst = xClone.state as Extract<PNode, { t: 'tuple' }>;
  return {
    ...xClone,
    state: { t: 'tuple', items: [...cst.items.slice(0, 4), encode(bytes)] },
  };
}

const TORCH_ELEMENT: Record<string, ExportDtype> = {
  'torch.FloatStorage': { kind: 'f', size: 4, littleEndian: true },
  'torch.DoubleStorage': { kind: 'f', size: 8, littleEndian: true },
  'torch.LongStorage': { kind: 'i', size: 8, littleEndian: true },
  'torch.IntStorage': { kind: 'i', size: 4, littleEndian: true },
  'torch.ShortStorage': { kind: 'i', size: 2, littleEndian: true },
  'torch.CharStorage': { kind: 'i', size: 1, littleEndian: true },
  'torch.ByteStorage': { kind: 'u', size: 1, littleEndian: true },
};

/** Per-graph state of patched torch storages: clone key -> new key (shared storages stay shared). */
type TorchKeyMap = Map<string, string>;

// ---------------------------------------------------------------------------------------------
// Matrices
// ---------------------------------------------------------------------------------------------

const MATRIX_KEYS = ['lm_to_lm_matrix', 'lm_to_lm_vote_matrix', 'sm_to_lm_matrix'] as const;

/** LM provenance: per manifest LM, the on-disk lm_dict key it came from, or null. */
export function lmProvenance(manifest: ExportManifest): (number | null)[] {
  return manifest.lms.map((l) => (l.origin ? l.origin.lmId : null));
}

function isListConfig(n: PNode | undefined): n is PObj {
  return !!n && n.t === 'obj' && isGlobal(n.fn, 'omegaconf.listconfig', 'ListConfig');
}

function isPlainMatrix(n: PNode): boolean {
  if (n.t !== 'list') return false;
  return n.items.every((r) => r.t === 'list' && r.items.every((e) => e.t === 'int'));
}

function hasIntKey(meta: PNode | undefined): boolean {
  return !!meta && meta.t === 'obj' && attr(meta, 'key')?.t === 'int';
}

/** Read-only check of a ListConfig matrix (two levels of `_content`, `_parent` by identity). */
export function checkListConfigMatrix(node: PNode): boolean {
  if (!isListConfig(node)) return false;
  const content = attr(node, '_content');
  const meta = attr(node, '_metadata');
  if (!content || content.t !== 'list' || !meta || meta.t !== 'obj') return false;
  for (const row of content.items) {
    if (!isListConfig(row)) return false;
    const rc = attr(row, '_content');
    if (!rc || rc.t !== 'list') return false;
    if (!hasIntKey(attr(row, '_metadata'))) return false;
    if (attr(row, '_parent') !== node) return false;
    for (const el of rc.items) {
      if (el.t !== 'obj') return false;
      if (attr(el, '_val')?.t !== 'int') return false;
      if (!hasIntKey(attr(el, '_metadata'))) return false;
      if (attr(el, '_parent') !== row) return false;
    }
  }
  return true;
}

/** Replaces the value of attribute `name` of a rebuild-owned node in place. */
function setAttr(n: PNode, name: string, value: PNode): void {
  const p = attrPair(n, name);
  if (!p) throw new ExportError(`internal: attribute ${name} not found`);
  p[1] = value;
}

/** A new obj like `o` whose state has `key` replaced (copy-on-write of the state dict). */
function withMetadataKey(meta: PObj, key: number): PObj {
  const st = meta.state;
  const remapDict = (d: PNode): PNode =>
    d.t === 'dict'
      ? {
          t: 'dict',
          items: d.items.map(([k, v]) =>
            strValue(k) === 'key' ? [k, { t: 'int', v: key } as PNode] : [k, v],
          ),
        }
      : d;
  let state: PNode | undefined = st;
  if (st?.t === 'dict') state = remapDict(st);
  else if (st?.t === 'tuple' && st.items.length === 2) {
    state = { t: 'tuple', items: st.items.map(remapDict) };
  }
  return { ...meta, state };
}

function renumberMetadata(n: PNode, index: number): void {
  const meta = attr(n, '_metadata');
  if (!meta || meta.t !== 'obj') return;
  const k = attr(meta, 'key');
  if (k?.t === 'int' && k.v === index) return;
  setAttr(n, '_metadata', withMetadataKey(meta, index));
}

/**
 * Rebuilds one matrix from `lmMap`; returns the new node, or undefined when the matrix is in a
 * form the exporter does not recognise (left unchanged).
 */
function rebuildMatrix(
  pristine: PNode,
  lmMap: readonly (number | null)[],
  lmIndex: boolean,
  key: string,
): PNode | undefined {
  const firstNew = new Map<number, number>();
  lmMap.forEach((old, j) => {
    if (old !== null && !firstNew.has(old)) firstNew.set(old, j);
  });

  if (isPlainMatrix(pristine)) {
    const oldRows = (pristine as Extract<PNode, { t: 'list' }>).items;
    const rows: PNode[] = lmMap.map((old) => {
      if (old === null || old >= oldRows.length) return { t: 'list', items: [] };
      const src = oldRows[old] as Extract<PNode, { t: 'list' }>;
      if (!lmIndex) return { t: 'list', items: src.items.slice() };
      const items: PNode[] = [];
      for (const e of src.items) {
        const j = firstNew.get((e as { v: number }).v);
        if (j !== undefined) items.push({ t: 'int', v: j });
      }
      return { t: 'list', items };
    });
    return { t: 'list', items: rows };
  }

  if (!checkListConfigMatrix(pristine)) return undefined;
  const oldContent = attr(pristine, '_content') as Extract<PNode, { t: 'list' }>;
  const needsEmpty = lmMap.some((old) => old === null || old >= oldContent.items.length);
  if (needsEmpty && oldContent.items.length === 0) return undefined;

  const parent = attr(pristine, '_parent');
  const keep = parent && parent.t !== 'none' ? new Set<PNode>([parent]) : undefined;
  const m = cloneSubtree(pristine, { remapStorages: false, keep });
  const oldRows = (attr(m, '_content') as Extract<PNode, { t: 'list' }>).items;
  const keepM = new Set<PNode>([m]);
  // Pass 1: pick every row before anything is rewritten, so a later use of an old row is cloned
  // from its on-disk values (not from a row whose entries were already re-mapped).
  const used = new Set<number>();
  const rows: PNode[] = [];
  const emptyRow: boolean[] = [];
  for (const old of lmMap) {
    if (old !== null && old < oldRows.length) {
      if (!used.has(old)) {
        used.add(old);
        rows.push(oldRows[old]);
      } else {
        rows.push(cloneSubtree(oldRows[old], { remapStorages: false, keep: keepM }));
      }
      emptyRow.push(false);
    } else {
      // Cloned before pass 2 edits the template row.
      rows.push(cloneSubtree(oldRows[0], { remapStorages: false, keep: keepM }));
      emptyRow.push(true);
    }
  }
  // Pass 2: rewrite each row once.
  rows.forEach((row, r) => {
    if (emptyRow[r]) {
      setAttr(row, '_content', { t: 'list', items: [] });
      return;
    }
    if (!lmIndex) return;
    const content = attr(row, '_content') as Extract<PNode, { t: 'list' }>;
    const items: PNode[] = [];
    for (const el of content.items) {
      const v = (attr(el, '_val') as { v: number }).v;
      const j = firstNew.get(v);
      if (j === undefined) continue;
      setAttr(el, '_val', { t: 'int', v: j });
      items.push(el);
    }
    items.forEach((el, p) => renumberMetadata(el, p));
    setAttr(row, '_content', { t: 'list', items });
  });
  rows.forEach((row, i) => {
    renumberMetadata(row, i);
    if (attr(row, '_parent') !== m) {
      throw new ExportError(`internal: ListConfig parent mismatch in ${key}`);
    }
    const content = attr(row, '_content') as Extract<PNode, { t: 'list' }>;
    for (const el of content.items) {
      if (attr(el, '_parent') !== row) {
        throw new ExportError(`internal: ListConfig parent mismatch in ${key}`);
      }
    }
  });
  setAttr(m, '_content', { t: 'list', items: rows });
  return m;
}

// ---------------------------------------------------------------------------------------------
// Rebuild
// ---------------------------------------------------------------------------------------------

export interface RebuildContext {
  manifest: ExportManifest;
  destAst: PickleAst;
  /** Indexes of every source, keyed by file id (the destination included). */
  indexes: Map<string, SourceIndex>;
  alloc: StorageKeyAllocator;
  /** Bytes of storage `key` (its key in that file) of source `fileId`; throws ExportError when missing. */
  readStorage(fileId: string, key: string): Promise<Uint8Array>;
  /** Content of the `byteorder` entry of source `fileId`, or undefined when it has none. */
  byteOrder(fileId: string): Promise<string | undefined>;
}

export interface RebuildResult {
  ast: PickleAst;
  remap: StorageRemap;
  /** newKey -> bytes of a storage patched by an object_id rewrite. */
  patched: Map<string, Uint8Array>;
  warnings: string[];
}

const SET_ITEM_KEYS = ['graph_memory', 'graph_id_to_target', 'target_to_graph_id'] as const;

/** Members of a `builtins.set` REDUCE node `set([...])`, or undefined for another form. */
function setMembers(n: PNode): { fn: PNode; members: PNode[] } | undefined {
  if (n.t !== 'obj' || n.fn.t !== 'global') return undefined;
  if (!((n.fn.module === 'builtins' || n.fn.module === '__builtin__') && n.fn.name === 'set')) {
    return undefined;
  }
  if (n.args.t !== 'tuple') return undefined;
  if (n.args.items.length === 0) return { fn: n.fn, members: [] };
  const l = n.args.items[0];
  if (n.args.items.length !== 1 || l.t !== 'list') return undefined;
  return { fn: n.fn, members: l.items };
}

function makeSet(fn: PNode, members: PNode[]): PNode {
  return {
    t: 'obj',
    via: 'reduce',
    fn,
    args: { t: 'tuple', items: [{ t: 'list', items: members }] },
  };
}

/** Builds the export's destination tree from the manifest (the parsed trees are not modified). */
export async function rebuildDestination(ctx: RebuildContext): Promise<RebuildResult> {
  const { manifest, indexes, alloc } = ctx;
  const destId = manifest.dest.fileId;
  const destIndex = indexes.get(destId);
  if (!destIndex) throw new ExportError('internal: destination not indexed');
  const remap: StorageRemap = new Map();
  const patched = new Map<string, Uint8Array>();
  const warnings: string[] = [];
  const nameOf = (fileId: string) =>
    indexes.get(fileId)?.fileName ?? manifest.sources[fileId]?.name ?? fileId;
  const changed = (fileId: string) =>
    new ExportError(`${nameOf(fileId)} changed since it was opened; reopen it and export again`);

  // A builtins.set global to reuse for new target sets (any parsed one), else __builtin__.set.
  let setFn: PNode | undefined;
  for (const idx of [destIndex, ...indexes.values()]) {
    for (const lm of idx.lms.values()) {
      for (const s of lm.idToTarget.values()) {
        const m = setMembers(s);
        if (m) {
          setFn = m.fn;
          break;
        }
      }
      if (setFn) break;
    }
    if (setFn) break;
  }
  setFn ??= { t: 'global', module: '__builtin__', name: 'set' };

  const firstShell = (() => {
    const keys = [...destIndex.lms.keys()].sort((a, b) => a - b);
    return keys.length > 0 ? destIndex.lms.get(keys[0])!.shell : undefined;
  })();

  const usedOrigins = new Set<string>();
  const newLmItems: [PNode, PNode][] = [];

  for (let i = 0; i < manifest.lms.length; i++) {
    const mlm = manifest.lms[i];
    if (mlm.gap && mlm.graphs.length === 0) continue;

    const gmItems: [PNode, PNode][] = [];
    const g2tItems: [PNode, PNode][] = [];
    const targets = new Map<string, { key: PNode; graphs: PNode[] }>();

    for (const g of mlm.graphs) {
      const { keyNode, value, targetSet } = await buildGraph(g, i);
      gmItems.push([keyNode, value]);
      if (!targetSet) continue; // no graph_id_to_target entry on disk, and nothing changed
      g2tItems.push([keyNode, targetSet]);
      const ms = setMembers(targetSet);
      if (ms) {
        for (const member of ms.members) {
          const s = strValue(member);
          const ck = s !== undefined ? `s:${s}` : (canonKey(member) ?? `?${targets.size}`);
          let t = targets.get(ck);
          if (!t) {
            t = { key: s !== undefined ? { t: 'str', v: s } : member, graphs: [] };
            targets.set(ck, t);
          }
          t.graphs.push(keyNode);
        }
      }
    }
    const t2gItems: [PNode, PNode][] = [...targets.values()].map((t) => [
      t.key,
      makeSet(setFn!, t.graphs),
    ]);
    const built: Record<(typeof SET_ITEM_KEYS)[number], PNode> = {
      graph_memory: { t: 'dict', items: gmItems },
      graph_id_to_target: { t: 'dict', items: g2tItems },
      target_to_graph_id: { t: 'dict', items: t2gItems },
    };

    let shell: PNode;
    if (mlm.origin) {
      const srcLm = destIndex.lms.get(mlm.origin.lmId);
      if (mlm.origin.fileId !== destId || !srcLm) throw changed(destId);
      const pairs = dictPairs(srcLm.shell)!;
      const items: [PNode, PNode][] = pairs.map(([k, v]) => {
        const name = strValue(k);
        if (
          name === 'graph_memory' ||
          name === 'graph_id_to_target' ||
          name === 'target_to_graph_id'
        ) {
          return [k, built[name]];
        }
        return [k, v];
      });
      shell = { t: 'dict', items };
    } else {
      const items: [PNode, PNode][] = SET_ITEM_KEYS.map((k) => [{ t: 'str', v: k }, built[k]]);
      for (const [k, v] of dictPairs(firstShell) ?? []) {
        const name = strValue(k);
        if (name !== undefined && (SET_ITEM_KEYS as readonly string[]).includes(name)) continue;
        if (['none', 'bool', 'int', 'float', 'str'].includes(v.t)) items.push([k, v]);
      }
      shell = { t: 'dict', items };
    }
    newLmItems.push([{ t: 'int', v: i }, shell]);
  }

  async function buildGraph(
    g: ManifestGraph,
    lmIndex: number,
  ): Promise<{ keyNode: PNode; value: PNode; targetSet: PNode | undefined }> {
    const o: GraphOrigin = g.origin;
    const idx = indexes.get(o.fileId);
    const srcLm = idx?.lms.get(o.lmId);
    const src = srcLm?.entries[o.entry];
    if (!idx || !srcLm || !src) throw changed(o.fileId);
    const own = o.fileId === destId;
    const originKey = `${o.fileId}:${o.lmId}:${o.entry}`;
    const first = own && !usedOrigins.has(originKey);
    usedOrigins.add(originKey);
    const renamed = !g.unreadable && g.name !== src.name;
    const patches = g.unreadable ? [] : g.patches;
    const changedGraph = renamed || patches.length > 0;

    let value: PNode;
    if (first && !changedGraph) value = src.value;
    else {
      value = cloneSubtree(src.value, {
        remapStorages: !first,
        fileId: o.fileId,
        remap,
        alloc,
      });
    }
    const keyNode: PNode = renamed ? { t: 'str', v: g.name } : src.key;

    // object_id of every channel's object model (pristine decides).
    const pristineChannels = dictPairs(src.value) ?? [];
    const cloneChannels = value === src.value ? [] : (dictPairs(value) ?? []);
    if (renamed) {
      pristineChannels.forEach(([, objModel], c) => {
        const oid = attr(objModel, 'object_id');
        if (oid && oid.t === 'str' && decodeText(oid.v) === src.name) {
          const cm = cloneChannels[c]?.[1];
          if (cm) setAttr(cm, 'object_id', { t: 'str', v: g.name });
        }
      });
    }

    if (patches.length > 0) {
      await applyGraphPatches(g, lmIndex, src, value, patches);
    }

    // graph_id_to_target
    const pristineSet = srcLm.idToTarget.get(targetLookupKey(src.key));
    let targetSet: PNode | undefined;
    const members = pristineSet ? setMembers(pristineSet) : { fn: setFn!, members: [] };
    const hasOldName = members?.members.some((m) => strValue(m) === src.name) ?? false;
    if (!pristineSet && own && !renamed) {
      // The graph has no graph_id_to_target entry on disk and keeps its name in its own file:
      // keep it absent, so untouched content is written back unchanged in value. (A renamed,
      // duplicated or copied graph without an entry gets an empty set, below.)
      targetSet = undefined;
    } else if (pristineSet && own && !renamed && !hasOldName) {
      targetSet = pristineSet;
    } else if (!members) {
      if (!renamed && pristineSet) targetSet = pristineSet;
      else {
        throw new ExportError(
          `${nameOf(o.fileId)} has graph_id_to_target[${pyRepr(src.name)}] in an unsupported form; it cannot be exported`,
        );
      }
    } else {
      targetSet = makeSet(
        members.fn,
        members.members.map((m) => (strValue(m) === src.name ? { t: 'str', v: g.name } : m)),
      );
    }
    return { keyNode, value, targetSet };
  }

  async function applyGraphPatches(
    g: ManifestGraph,
    lmIndex: number,
    src: SourceEntry,
    clone: PNode,
    patches: ObjectIdPatch[],
  ): Promise<void> {
    const byChannel = new Map<string, ObjectIdPatch[]>();
    for (const p of patches) {
      let l = byChannel.get(p.channel);
      if (!l) byChannel.set(p.channel, (l = []));
      l.push(p);
    }
    const torchKeys: TorchKeyMap = new Map();
    for (const [channel, list] of byChannel) {
      try {
        const pristineModel = dictGet(src.value, channel);
        const cloneModel = dictGet(clone, channel);
        const pf = pristineModel && graphFields(pristineModel);
        const cf = cloneModel && graphFields(cloneModel);
        if (!pf || !cf) fail('no x / feature_mapping found');
        const xP = pf!.x;
        const xC = cf!.x;
        let newX: PNode;
        if (isNumpyArray(xP) && isNumpyArray(xC)) {
          newX = patchNumpy(xC, xP, pf!.featureMapping, list);
        } else if (isTorchTensor(xP) && isTorchTensor(xC)) {
          newX = await patchTorch(xC, pf!.featureMapping, list, torchKeys);
        } else {
          fail('no x / feature_mapping found');
        }
        const pair = dictPair(cf!.fields, 'x');
        if (!pair) fail('no x / feature_mapping found');
        pair![1] = newX!;
      } catch (err) {
        if (err instanceof PatchFailure) {
          throw new ExportError(
            `Cannot rewrite object_id references in ${g.name} (LM ${lmIndex}) / ${channel}: ${err.message}`,
          );
        }
        throw err;
      }
    }
  }

  async function patchTorch(
    xC: PObj,
    fm: PNode,
    patches: ObjectIdPatch[],
    keys: TorchKeyMap,
  ): Promise<PNode> {
    if (xC.args.t !== 'tuple' || xC.args.items.length < 4) fail('no x / feature_mapping found');
    const args = (xC.args as Extract<PNode, { t: 'tuple' }>).items;
    const [persid, offsetN, sizeN, strideN] = args;
    if (persid.t !== 'persid' || persid.pid.t !== 'tuple' || persid.pid.items.length !== 5) {
      fail('no x / feature_mapping found');
    }
    const pid = (persid as Extract<PNode, { t: 'persid' }>).pid as Extract<PNode, { t: 'tuple' }>;
    const [, clsN, keyN, , numelN] = pid.items;
    const cls = clsN.t === 'global' ? `${clsN.module}.${clsN.name}` : '?';
    const t = TORCH_ELEMENT[cls];
    if (!t) fail(`storage class ${cls}`);
    const [N, F] = shape2(sizeN);
    const stride = strideN.t === 'tuple' ? strideN.items.map(intValue) : [];
    const strideOk =
      stride.length === 2 && (N === 1 || stride[0] === F) && (F === 1 || stride[1] === 1);
    if (!strideOk) {
      fail(`non-contiguous tensor (stride ${stride.map((s) => s ?? '?').join(', ')})`);
    }
    const offset = intValue(offsetN);
    const numel = intValue(numelN);
    if (offset === undefined || numel === undefined || offset < 0 || offset + N * F > numel) {
      fail('x is not 2-D');
    }
    const col = objectIdColumn(fm, F);
    const key = strValue(keyN) ?? '';
    let newKey = keys.get(key);
    let buf: Uint8Array;
    if (newKey !== undefined) {
      buf = patched.get(newKey)!;
    } else {
      // A clone with remapped storages names a new key; otherwise the key is the destination's.
      const from = remap.get(key) ?? { fileId: destId, oldKey: key };
      const order = await ctx.byteOrder(from.fileId);
      if (order !== undefined && order !== 'little') fail('unsupported dtype big-endian storage');
      buf = (await ctx.readStorage(from.fileId, from.oldKey)).slice();
      if (buf.length !== numel! * t!.size) fail('x is not 2-D');
      newKey = alloc.next();
      keys.set(key, newKey);
      patched.set(newKey, buf);
    }
    applyPatches(buf, t!, N, (r) => offset! + r * F + col, patches);
    const newPersid: PNode = {
      t: 'persid',
      pid: {
        t: 'tuple',
        items: [pid.items[0], pid.items[1], { t: 'str', v: newKey }, pid.items[3], pid.items[4]],
      },
    };
    return { ...xC, args: { t: 'tuple', items: [newPersid, ...args.slice(1)] } };
  }

  // Root: same pairs, new lm_dict, rebuilt matrices.
  const newLmDict: PNode = { t: 'dict', items: newLmItems };
  const rootPairs = dictPairs(destIndex.root);
  if (!rootPairs || destIndex.root.t !== 'dict') throw changed(destId);
  const lmMap = lmProvenance(manifest);
  const n = destIndex.lms.size === 0 ? 0 : Math.max(...destIndex.lms.keys()) + 1;
  const identity =
    lmMap.length === n &&
    lmMap.every(
      (v, i) => v === i || (v === null && manifest.lms[i].gap === true && !destIndex.lms.has(i)),
    );
  const newRootItems: [PNode, PNode][] = rootPairs.map(([k, v]) => {
    const name = strValue(k);
    if (name === 'lm_dict') return [k, newLmDict];
    if (
      !identity &&
      name !== undefined &&
      (MATRIX_KEYS as readonly string[]).includes(name) &&
      v.t !== 'none'
    ) {
      const rebuilt = rebuildMatrix(v, lmMap, name !== 'sm_to_lm_matrix', name);
      if (rebuilt) return [k, rebuilt];
      warnings.push(`${name} has an unrecognised form and was left unchanged`);
    }
    return [k, v];
  });
  return {
    ast: { proto: ctx.destAst.proto, root: { t: 'dict', items: newRootItems } },
    remap,
    patched,
    warnings,
  };
}
