/**
 * Lazy reader for torch's STORED zip container (spec Phase 2 "Container", "Bounds and
 * validation" → Zip). Reads only the tail (EOCD), the central directory and the entries asked
 * for, via `Blob.slice()`.
 */
import { ParseError } from './errors';

const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ZIP64_EOCD = 0x06064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const EOCD_SIZE = 22;
const MAX_COMMENT = 70_000;
const U32_MAX = 0xffffffff;
const U16_MAX = 0xffff;

export interface ZipEntry {
  localOffset: number;
  size: number;
}

export interface Zip {
  entries: Map<string, ZipEntry>;
  /** Directory holding the single `data.pkl` (`model` or `archive` for torch files). */
  prefix: string;
  read(name: string): Promise<Uint8Array>;
}

const nameDecoder = new TextDecoder('utf-8', { fatal: true });

async function sliceBytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

function u64(dv: DataView, at: number, what: string): number {
  const v = dv.getBigUint64(at, true);
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new ParseError(`Zip ${what} out of range`);
  return Number(v);
}

function inFile(v: number, size: number, what: string): void {
  if (!Number.isSafeInteger(v) || v < 0 || v > size)
    throw new ParseError(`Zip ${what} out of range`);
}

export async function openZip(file: Blob): Promise<Zip> {
  const size = file.size;
  if (size < EOCD_SIZE) throw new ParseError('Not a zip file');
  const tailLen = Math.min(size, MAX_COMMENT + EOCD_SIZE);
  const tailStart = size - tailLen;
  const tail = await sliceBytes(file, tailStart, size);
  const tdv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);

  let eocd = -1;
  for (let k = tailLen - EOCD_SIZE; k >= 0; k--) {
    if (
      tdv.getUint32(k, true) === SIG_EOCD &&
      k + EOCD_SIZE + tdv.getUint16(k + 20, true) <= tailLen
    ) {
      eocd = k;
      break;
    }
  }
  if (eocd < 0) throw new ParseError('Not a zip file');
  const eocdAbs = tailStart + eocd;

  const diskNo = tdv.getUint16(eocd + 4, true);
  const cdDisk = tdv.getUint16(eocd + 6, true);
  let count = tdv.getUint16(eocd + 10, true);
  let cdSize = tdv.getUint32(eocd + 12, true);
  let cdOffset = tdv.getUint32(eocd + 16, true);
  let cdEnd = eocdAbs;

  if (count === U16_MAX || cdSize === U32_MAX || cdOffset === U32_MAX) {
    // zip64: locator right before the EOCD gives the zip64 EOCD's absolute offset.
    const locAbs = eocdAbs - 20;
    if (locAbs < 0) throw new ParseError('Bad zip64 locator');
    const loc =
      locAbs >= tailStart
        ? tail.subarray(locAbs - tailStart, locAbs - tailStart + 20)
        : await sliceBytes(file, locAbs, locAbs + 20);
    const ldv = new DataView(loc.buffer, loc.byteOffset, loc.byteLength);
    if (loc.length !== 20 || ldv.getUint32(0, true) !== SIG_ZIP64_LOCATOR)
      throw new ParseError('Bad zip64 locator signature');
    const z64Abs = u64(ldv, 8, 'zip64 EOCD offset');
    inFile(z64Abs + 56, locAbs, 'zip64 EOCD offset');
    const z64 =
      z64Abs >= tailStart
        ? tail.subarray(z64Abs - tailStart, z64Abs - tailStart + 56)
        : await sliceBytes(file, z64Abs, z64Abs + 56);
    const zdv = new DataView(z64.buffer, z64.byteOffset, z64.byteLength);
    if (z64.length !== 56 || zdv.getUint32(0, true) !== SIG_ZIP64_EOCD)
      throw new ParseError('Bad zip64 EOCD signature');
    count = u64(zdv, 32, 'entry count');
    cdSize = u64(zdv, 40, 'central directory size');
    cdOffset = u64(zdv, 48, 'central directory offset');
    cdEnd = z64Abs;
  } else if (diskNo !== 0 || cdDisk !== 0) {
    throw new ParseError('Multi-disk zip files are not supported');
  }

  inFile(cdOffset, size, 'central directory offset');
  inFile(cdSize, size, 'central directory size');
  if (cdOffset + cdSize > cdEnd) throw new ParseError('Zip central directory out of range');
  // Each central record is >= 46 bytes.
  if (count * 46 > cdSize)
    throw new ParseError('Zip entry count does not match the central directory');

  const cd = await sliceBytes(file, cdOffset, cdOffset + cdSize);
  const dv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > cd.length) throw new ParseError('Truncated zip central directory');
    if (dv.getUint32(p, true) !== SIG_CENTRAL)
      throw new ParseError('Bad zip central directory signature');
    const method = dv.getUint16(p + 10, true);
    let compSize = dv.getUint32(p + 20, true);
    let rawSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commLen = dv.getUint16(p + 32, true);
    let localOffset = dv.getUint32(p + 42, true);
    const recEnd = p + 46 + nameLen + extraLen + commLen;
    if (recEnd > cd.length) throw new ParseError('Truncated zip central directory');
    let name: string;
    try {
      name = nameDecoder.decode(cd.subarray(p + 46, p + 46 + nameLen));
    } catch {
      throw new ParseError('Invalid zip entry name');
    }
    // zip64 extended information extra field (0x0001).
    let e = p + 46 + nameLen;
    const eEnd = e + extraLen;
    while (e < eEnd) {
      if (e + 4 > eEnd) throw new ParseError('Truncated zip extra field');
      const id = dv.getUint16(e, true);
      const flen = dv.getUint16(e + 2, true);
      if (e + 4 + flen > eEnd) throw new ParseError('Truncated zip extra field');
      if (id === 0x0001) {
        let q = e + 4;
        const take = (what: string) => {
          if (q + 8 > e + 4 + flen) throw new ParseError('Truncated zip64 extra field');
          const v = u64(dv, q, what);
          q += 8;
          return v;
        };
        if (rawSize === U32_MAX) rawSize = take('entry size');
        if (compSize === U32_MAX) compSize = take('entry size');
        if (localOffset === U32_MAX) localOffset = take('local header offset');
      }
      e += 4 + flen;
    }
    if (method !== 0) throw new ParseError('Compressed zip entries are not supported');
    if (rawSize === U32_MAX || compSize === U32_MAX || localOffset === U32_MAX) {
      throw new ParseError('Missing zip64 extra field');
    }
    if (compSize !== rawSize) throw new ParseError(`Zip entry size mismatch for ${name}`);
    inFile(localOffset, size, 'local header offset');
    inFile(rawSize, size, 'entry size');
    if (localOffset + 30 + rawSize > size) throw new ParseError(`Zip entry ${name} out of range`);
    if (entries.has(name)) throw new ParseError(`Duplicate zip entry ${name}`);
    entries.set(name, { localOffset, size: rawSize });
    p = recEnd;
  }
  if (p !== cd.length) throw new ParseError('Zip entry count does not match the central directory');

  const pkls = [...entries.keys()].filter((k) => /^[^/]+\/data\.pkl$/.test(k));
  if (pkls.length === 0) throw new ParseError('No data.pkl in the zip (not a torch file)');
  if (pkls.length > 1) throw new ParseError('Multiple data.pkl entries in the zip');
  const prefix = pkls[0].slice(0, -'/data.pkl'.length);

  async function read(entryName: string): Promise<Uint8Array> {
    const ent = entries.get(entryName);
    if (!ent) throw new ParseError(`Missing zip entry ${entryName}`);
    const hdr = await sliceBytes(file, ent.localOffset, ent.localOffset + 30);
    const hdv = new DataView(hdr.buffer, hdr.byteOffset, hdr.byteLength);
    if (hdr.length !== 30 || hdv.getUint32(0, true) !== SIG_LOCAL) {
      throw new ParseError(`Bad zip local header for ${entryName}`);
    }
    const start = ent.localOffset + 30 + hdv.getUint16(26, true) + hdv.getUint16(28, true);
    const end = start + ent.size;
    if (end > size) throw new ParseError(`Zip entry ${entryName} out of range`);
    const data = await sliceBytes(file, start, end);
    if (data.length !== ent.size) throw new ParseError(`Truncated zip entry ${entryName}`);
    return data;
  }

  return { entries, prefix, read };
}
