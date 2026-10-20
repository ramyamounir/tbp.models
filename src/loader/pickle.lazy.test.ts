import { beforeEach, describe, expect, it } from 'vitest';
import { ParseError } from './errors';
import {
  NumpyArray,
  latin1FromUtf8,
  materializeCount,
  numpyArrayData,
  resetMaterializeCount,
} from './numpy';
import { parseModelFile } from './parse';
import { LAZY_PAYLOAD_THRESHOLD, Latin1Bytes, LazyBytes, unpickle } from './pickle';
import { own, type PyValue } from './pyvalue';
import { findClass, makePersistentLoad } from './torch';
import { PickleWriter, buildModelPt } from './testFixture';

const te = new TextEncoder();
const hooks = () => ({ findClass, persistentLoad: makePersistentLoad(new Map()) });

/** UTF-8 text of the latin-1 decoding of `bytes` (what Python writes for `bytes` payloads). */
function utf8OfLatin1(bytes: Uint8Array): Uint8Array {
  let s = '';
  for (let k = 0; k < bytes.length; k += 8192)
    s += String.fromCharCode(...bytes.subarray(k, k + 8192));
  return te.encode(s);
}

const BIG = 2 * 1024 * 1024; // 2 MiB of float64 payload
function bigPayload(): Uint8Array {
  const b = new Uint8Array(BIG);
  for (let k = 0; k < BIG; k++) b[k] = (k * 7) & 0xff;
  return b;
}

/** sm_dict = {0: {'raw_observations': <numpy f8 array with a 2 MiB lazily-encoded payload>}} */
function writeSmDict(w: PickleWriter) {
  const payload = utf8OfLatin1(bigPayload());
  w.dictOf([
    [
      0,
      (w1) =>
        void w1.dictOf([
          [
            'raw_observations',
            (w2) =>
              void w2.numpyArray([BIG / 8], 'f8', (w3) => {
                w3.global('_codecs', 'encode');
                w3.mark().unicodeBytes(payload).str('latin1').tuple();
                w3.reduce();
              }),
          ],
        ]),
    ],
  ]);
}

function smDictPickle(): Uint8Array {
  const w = new PickleWriter().proto();
  w.dictOf([['sm_dict', writeSmDict]]);
  return w.stop().bytes();
}

describe('large inline payloads', () => {
  beforeEach(() => resetMaterializeCount());

  it('(a) keeps a 2 MiB BINUNICODE under sm_dict unread, and the graph still loads', async () => {
    const root = unpickle(smDictPickle(), hooks());
    // sm_dict has an int key: fetch it with Map.get (own() reads string fields).
    const sm = own(root, 'sm_dict') as Map<PyValue, PyValue>;
    const obs = own(sm.get(0), 'raw_observations');
    expect(obs).toBeInstanceOf(NumpyArray);
    const raw = (obs as NumpyArray).raw;
    expect(raw).toBeInstanceOf(Latin1Bytes);
    expect((raw as Latin1Bytes).src).toBeInstanceOf(LazyBytes);
    expect((raw as Latin1Bytes).src.view.length).toBeGreaterThan(LAZY_PAYLOAD_THRESHOLD);
    expect(materializeCount).toBe(0);

    const m = await parseModelFile(
      new Blob([
        buildModelPt({ extraRoot: [['sm_dict', writeSmDict]] }) as Uint8Array<ArrayBuffer>,
      ]),
      'x.pt',
    );
    expect(m.lms[0].graphIds).toEqual(['g']);
    expect(m.lms[0].graphs.get('g')!.channels[0].n).toBe(4);
    expect(materializeCount).toBe(0);

    // Materializing the lazy array on demand decodes the exact bytes.
    const bytes = numpyArrayData(obs as NumpyArray);
    expect(materializeCount).toBe(1);
    expect(bytes).toEqual(bigPayload());
  });

  it('(b) latin1FromUtf8 decodes all code points 0..255', () => {
    const all = new Uint8Array(256).map((_, k) => k);
    expect(latin1FromUtf8(utf8OfLatin1(all))).toEqual(all);
  });

  it('(c) rejects code points > 0xFF and truncated sequences when materialized', () => {
    expect(() => latin1FromUtf8(new Uint8Array([0x41, 0xe2, 0x82, 0xac]))).toThrow(ParseError);
    expect(() => latin1FromUtf8(new Uint8Array([0x41, 0xe2, 0x82, 0xac]))).toThrow(
      /Invalid latin-1 payload at byte 1/,
    );
    expect(() => latin1FromUtf8(new Uint8Array([0x41, 0xc3]))).toThrow(
      /Invalid latin-1 payload at byte 1/,
    );
    expect(() => latin1FromUtf8(new Uint8Array([0x80]))).toThrow(ParseError);

    // Through numpyArrayData on a lazy array holding an invalid payload.
    const bad = new Uint8Array(LAZY_PAYLOAD_THRESHOLD + 8).fill(0x41);
    bad.set([0xe2, 0x82, 0xac], 100);
    const w = new PickleWriter().proto();
    w.numpyArray([bad.length / 8], 'u1', (w1) => {
      w1.global('_codecs', 'encode');
      w1.mark().unicodeBytes(bad).str('latin1').tuple();
      w1.reduce();
    });
    const arr = unpickle(w.stop().bytes(), hooks()) as NumpyArray;
    expect(arr.raw).toBeInstanceOf(Latin1Bytes);
    expect(() => numpyArrayData(arr)).toThrow(/Invalid latin-1 payload/);
  });

  it('(d) a BINUNICODE below the threshold decodes to a JS string', () => {
    const s = 'é'.repeat(1000);
    const w = new PickleWriter().proto().str(s).stop();
    expect(unpickle(w.bytes(), hooks())).toBe(s);
  });

  it('keeps large BINBYTES lazy as raw (non-UTF-8) bytes', () => {
    const n = LAZY_PAYLOAD_THRESHOLD + 1;
    const w = new PickleWriter()
      .proto()
      .raw(0x42, n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24);
    w.rawBytes(new Uint8Array(n)).stop();
    const v = unpickle(w.bytes(), hooks());
    expect(v).toBeInstanceOf(LazyBytes);
    expect((v as LazyBytes).utf8).toBe(false);
  });
});
