/**
 * STORED zip writer for exported model.pt files (spec Phase 4a "Zip writer", "Input zip safety").
 *
 * Writes method-0 entries only, with no data descriptors, utf-8 names, torch-style 64-byte data
 * alignment (extra field 0x4246 padded with 'Z') and zip64 records when sizes or offsets need
 * them. Copied entries are `Blob` slices of the input file, so storages never enter memory.
 */
import { ExportError } from './errors';

export interface ZipPart {
  name: string;
  crc32: number;
  size: number;
  data: (Uint8Array | Blob)[];
  /** Set for every part copied from an input zip as `file.slice(start, end)`; absent for bytes built in memory (data.pkl, patched storages). */
  copiedFrom?: { sourceId: string; fileSize: number; entry: string; start: number; end: number };
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;
const ALIGN = 64;
const FLAG_UTF8 = 0x0800;
// MS-DOS date 1980-01-01, time 00:00: fixed so the same input always gives the same bytes.
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;

const encoder = new TextEncoder();

// ---------------------------------------------------------------------------------------------
// Input zip safety
// ---------------------------------------------------------------------------------------------

const PREFIX_RE = /^[A-Za-z0-9_.-]+$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Throws ExportError unless `prefix` is a plain archive folder name (not `.` / `..`). */
export function checkArchivePrefix(prefix: string, fileName: string): void {
  if (PREFIX_RE.test(prefix) && prefix !== '.' && prefix !== '..') return;
  const shown = prefix.length > 64 ? `${prefix.slice(0, 64)}…` : prefix;
  throw new ExportError(
    `${fileName} has an unsupported zip archive prefix "${shown}"; it cannot be exported`,
  );
}

/**
 * True when `name` starts with `${prefix}/`, the rest is non-empty, no '/'-separated segment of
 * the rest is empty or '..', and `name` contains no backslash and no control character.
 */
export function isSafeEntryName(name: string, prefix: string): boolean {
  if (!name.startsWith(`${prefix}/`)) return false;
  if (name.includes('\\') || CONTROL_RE.test(name)) return false;
  const rest = name.slice(prefix.length + 1);
  if (rest === '') return false;
  for (const seg of rest.split('/')) if (seg === '' || seg === '..') return false;
  return true;
}

/** True for a tensor storage entry `${prefix}/data/<k>` with `k` a single non-empty segment. */
export function isStorageEntry(name: string, prefix: string): boolean {
  const head = `${prefix}/data/`;
  if (!name.startsWith(head)) return false;
  const k = name.slice(head.length);
  return k !== '' && !k.includes('/');
}

/**
 * The non-storage entries of a zip that may be copied: names from `order` (in order) other than
 * `${prefix}/data.pkl` and the storage entries, kept only if `isSafeEntryName`.
 */
export function selectCopiedEntries(
  order: readonly string[],
  prefix: string,
): { copy: string[]; dropped: number } {
  const copy: string[] = [];
  let dropped = 0;
  const pkl = `${prefix}/data.pkl`;
  for (const name of order) {
    if (name === pkl || isStorageEntry(name, prefix)) continue;
    if (isSafeEntryName(name, prefix)) copy.push(name);
    else dropped++;
  }
  return { copy, dropped };
}

export function droppedEntriesWarning(n: number): string {
  return `${n} unexpected zip entries were not copied`;
}

// ---------------------------------------------------------------------------------------------
// Pre-checks
// ---------------------------------------------------------------------------------------------

function preCheck(parts: readonly ZipPart[]): void {
  if (parts.length === 0) return;
  const first = parts[0].name;
  const slash = first.indexOf('/');
  const prefix = slash > 0 ? first.slice(0, slash) : '';
  // 1. names
  for (const p of parts) {
    if (prefix === '' || !isSafeEntryName(p.name, prefix)) {
      throw new ExportError('internal: unsafe zip entry name');
    }
  }
  const seen = new Set<string>();
  for (const p of parts) {
    if (seen.has(p.name)) throw new ExportError('internal: duplicate zip entry name');
    seen.add(p.name);
  }
  // 2. each copied range inside its file and matching the part size
  const bySource = new Map<string, Map<string, { start: number; end: number }>>();
  for (const p of parts) {
    const c = p.copiedFrom;
    if (!c) continue;
    if (
      !Number.isSafeInteger(c.start) ||
      !Number.isSafeInteger(c.end) ||
      c.end - c.start !== p.size ||
      c.start < 0 ||
      c.start > c.end ||
      c.end > c.fileSize
    ) {
      throw new ExportError('Overlapping zip entries');
    }
    // 3. group by source and entry; the same entry copied twice counts once
    let entries = bySource.get(c.sourceId);
    if (!entries) bySource.set(c.sourceId, (entries = new Map()));
    const prev = entries.get(c.entry);
    if (prev) {
      if (prev.start !== c.start || prev.end !== c.end) {
        throw new ExportError('Overlapping zip entries');
      }
    } else {
      entries.set(c.entry, { start: c.start, end: c.end });
    }
  }
  for (const entries of bySource.values()) {
    const ranges = [...entries.values()]
      .filter((r) => r.end > r.start)
      .sort((a, b) => a.start - b.start);
    for (let k = 1; k < ranges.length; k++) {
      if (ranges[k].start < ranges[k - 1].end) throw new ExportError('Overlapping zip entries');
    }
  }
}

function dataSize(data: readonly (Uint8Array | Blob)[]): number {
  let n = 0;
  for (const d of data) n += d instanceof Blob ? d.size : d.byteLength;
  return n;
}

// ---------------------------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------------------------

type BlobChunk = Uint8Array<ArrayBuffer> | Blob;

function header(n: number): { u8: Uint8Array<ArrayBuffer>; dv: DataView } {
  const u8 = new Uint8Array(n);
  return { u8, dv: new DataView(u8.buffer) };
}

function setU64(dv: DataView, at: number, v: number): void {
  dv.setBigUint64(at, BigInt(v), true);
}

function asChunk(d: Uint8Array | Blob): BlobChunk {
  if (d instanceof Blob) return d;
  return d.buffer instanceof ArrayBuffer
    ? (d as Uint8Array<ArrayBuffer>)
    : (new Uint8Array(d) as Uint8Array<ArrayBuffer>);
}

interface CentralInfo {
  nameBytes: Uint8Array;
  crc32: number;
  size: number;
  offset: number;
}

/** Writes `parts` in the given order as a STORED zip. Throws ExportError (see the pre-checks). */
export function writeZip(parts: ZipPart[]): Blob {
  preCheck(parts);
  for (const p of parts) {
    if (!Number.isSafeInteger(p.size) || p.size < 0 || dataSize(p.data) !== p.size) {
      throw new ExportError(`internal: zip entry ${p.name} size does not match its data`);
    }
  }

  const out: BlobChunk[] = [];
  const central: CentralInfo[] = [];
  let offset = 0;

  for (const p of parts) {
    const nameBytes = encoder.encode(p.name);
    if (nameBytes.length > U16_MAX) throw new ExportError('internal: zip entry name too long');
    const z64 = p.size >= U32_MAX;
    const z64Len = z64 ? 20 : 0; // id, len, original size, compressed size
    const base = offset + 30 + nameBytes.length + z64Len + 4;
    const pad = (ALIGN - (base % ALIGN)) % ALIGN;
    const extraLen = z64Len + 4 + pad;
    const { u8, dv } = header(30 + nameBytes.length + extraLen);
    dv.setUint32(0, SIG_LOCAL, true);
    dv.setUint16(4, z64 ? 45 : 20, true);
    dv.setUint16(6, FLAG_UTF8, true);
    dv.setUint16(8, 0, true); // STORED
    dv.setUint16(10, DOS_TIME, true);
    dv.setUint16(12, DOS_DATE, true);
    dv.setUint32(14, p.crc32 >>> 0, true);
    dv.setUint32(18, z64 ? U32_MAX : p.size, true);
    dv.setUint32(22, z64 ? U32_MAX : p.size, true);
    dv.setUint16(26, nameBytes.length, true);
    dv.setUint16(28, extraLen, true);
    u8.set(nameBytes, 30);
    let e = 30 + nameBytes.length;
    if (z64) {
      dv.setUint16(e, 0x0001, true);
      dv.setUint16(e + 2, 16, true);
      setU64(dv, e + 4, p.size);
      setU64(dv, e + 12, p.size);
      e += 20;
    }
    dv.setUint16(e, 0x4246, true); // "FB": torch's alignment padding
    dv.setUint16(e + 2, pad, true);
    u8.fill(0x5a, e + 4, e + 4 + pad); // 'Z'
    out.push(u8);
    for (const d of p.data) out.push(asChunk(d));
    central.push({ nameBytes, crc32: p.crc32 >>> 0, size: p.size, offset });
    offset += u8.length + p.size;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const c of central) {
    const bigSize = c.size >= U32_MAX;
    const bigOff = c.offset >= U32_MAX;
    const z64Len = bigSize || bigOff ? 4 + (bigSize ? 16 : 0) + (bigOff ? 8 : 0) : 0;
    const { u8, dv } = header(46 + c.nameBytes.length + z64Len);
    const ver = z64Len ? 45 : 20;
    dv.setUint32(0, SIG_CENTRAL, true);
    dv.setUint16(4, ver, true); // version made by
    dv.setUint16(6, ver, true); // version needed
    dv.setUint16(8, FLAG_UTF8, true);
    dv.setUint16(10, 0, true);
    dv.setUint16(12, DOS_TIME, true);
    dv.setUint16(14, DOS_DATE, true);
    dv.setUint32(16, c.crc32, true);
    dv.setUint32(20, bigSize ? U32_MAX : c.size, true);
    dv.setUint32(24, bigSize ? U32_MAX : c.size, true);
    dv.setUint16(28, c.nameBytes.length, true);
    dv.setUint16(30, z64Len, true);
    // comment length, disk start, internal and external attributes stay 0
    dv.setUint32(42, bigOff ? U32_MAX : c.offset, true);
    u8.set(c.nameBytes, 46);
    if (z64Len) {
      let e = 46 + c.nameBytes.length;
      dv.setUint16(e, 0x0001, true);
      dv.setUint16(e + 2, z64Len - 4, true);
      e += 4;
      if (bigSize) {
        setU64(dv, e, c.size);
        setU64(dv, e + 8, c.size);
        e += 16;
      }
      if (bigOff) setU64(dv, e, c.offset);
    }
    out.push(u8);
    cdSize += u8.length;
  }

  const count = central.length;
  const zip64 = count >= U16_MAX || cdSize >= U32_MAX || cdOffset >= U32_MAX;
  if (zip64) {
    const z64EocdOffset = cdOffset + cdSize;
    const { u8: rec, dv } = header(56 + 20);
    dv.setUint32(0, SIG_ZIP64_EOCD, true);
    setU64(dv, 4, 44); // size of the remaining record
    dv.setUint16(12, 45, true);
    dv.setUint16(14, 45, true);
    // disk numbers stay 0
    setU64(dv, 24, count);
    setU64(dv, 32, count);
    setU64(dv, 40, cdSize);
    setU64(dv, 48, cdOffset);
    dv.setUint32(56, SIG_ZIP64_LOCATOR, true);
    // disk with the zip64 EOCD stays 0
    setU64(dv, 64, z64EocdOffset);
    dv.setUint32(72, 1, true); // total disks
    out.push(rec);
  }
  const { u8: eocd, dv } = header(22);
  dv.setUint32(0, SIG_EOCD, true);
  dv.setUint16(8, zip64 ? U16_MAX : count, true);
  dv.setUint16(10, zip64 ? U16_MAX : count, true);
  dv.setUint32(12, zip64 ? U32_MAX : cdSize, true);
  dv.setUint32(16, zip64 ? U32_MAX : cdOffset, true);
  out.push(eocd);

  return new Blob(out);
}
