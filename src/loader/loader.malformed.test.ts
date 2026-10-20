import { existsSync, openAsBlob } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ParseError } from './errors';
import { parseModelFile } from './parse';
import { unpickle } from './pickle';
import { findClass, makePersistentLoad } from './torch';
import { FIXTURE_F, FIXTURE_N, buildModelPt, fixturePos, fixtureX, patchEocd } from './testFixture';

const parse = (bytes: Uint8Array) =>
  parseModelFile(new Blob([bytes as Uint8Array<ArrayBuffer>]), 'x.pt');
const hooks = () => ({ findClass, persistentLoad: makePersistentLoad(new Map()) });

async function expectParseError(p: () => Promise<unknown>, message?: RegExp) {
  const t0 = performance.now();
  let caught: unknown;
  try {
    await p();
  } catch (err) {
    caught = err;
  }
  expect(performance.now() - t0).toBeLessThan(2000);
  expect(caught).toBeInstanceOf(ParseError);
  if (message) expect((caught as Error).message).toMatch(message);
}

function expectSyncParseError(fn: () => unknown, message?: RegExp) {
  const t0 = performance.now();
  expect(fn).toThrow(ParseError);
  if (message) expect(fn).toThrow(message);
  expect(performance.now() - t0).toBeLessThan(2000);
}

const hexBytes = (...b: number[]) => new Uint8Array(b);

describe('valid fixture', () => {
  it('parses the default fixture', async () => {
    const m = await parse(buildModelPt());
    expect(m.lms).toHaveLength(1);
    expect(m.lms[0].graphIds).toEqual(['g']);
    const g = m.lms[0].graphs.get('g')!;
    expect(g.channels).toHaveLength(1);
    const c = g.channels[0];
    expect(c).toMatchObject({
      channel: 'patch',
      kind: 'sm',
      n: FIXTURE_N,
      F: FIXTURE_F,
      nonFiniteRows: 0,
    });
    expect([...c.pos]).toEqual([...fixturePos()]);
    expect([...c.x]).toEqual([...fixtureX()]);
    expect({ ...c.features }).toEqual({
      pose_vectors: [0, 9],
      pose_fully_defined: [9, 10],
      on_object: [10, 11],
    });
    expect(m.smToLm).toEqual([[0]]);
    expect(m.lmToLm).toEqual([[]]);
    expect(m.objectIdIndex.get(0)!.size).toBe(2);
  });

  it('parses inline numpy arrays (GridObjectModel style)', async () => {
    const m = await parse(buildModelPt({ arrays: 'numpy' }));
    const c = m.lms[0].graphs.get('g')!.channels[0];
    expect([...c.pos]).toEqual([...fixturePos()]);
    expect([...c.x]).toEqual([...fixtureX()]);
  });

  it('strips the legacy node_ids column and shifts the mapping', async () => {
    const m = await parse(buildModelPt({ legacy: true }));
    const c = m.lms[0].graphs.get('g')!.channels[0];
    expect(c.F).toBe(FIXTURE_F);
    expect([...c.x]).toEqual([...fixtureX()]);
    expect({ ...c.features }).toEqual({
      pose_vectors: [0, 9],
      pose_fully_defined: [9, 10],
      on_object: [10, 11],
    });
  });

  it('parses zip64 records and the archive/ prefix', async () => {
    const m = await parse(buildModelPt({ zip: { zip64: true }, prefix: 'archive' }));
    expect(m.lms[0].graphIds).toEqual(['g']);
  });

  it('counts non-finite pos rows and excludes them from the centroid', async () => {
    const pos = fixturePos();
    pos[0] = NaN;
    const m = await parse(buildModelPt({ pos: { bytes: new Uint8Array(pos.buffer) } }));
    const g = m.lms[0].graphs.get('g')!;
    expect(g.channels[0].nonFiniteRows).toBe(1);
    const finite = [1, 2, 3].map((r) => [r * 1 + 0.5, r * 2 + 0.5, r * 3 + 0.5]);
    expect(g.centroid).toEqual([0, 1, 2].map((k) => finite.reduce((s, p) => s + p[k], 0) / 3));
  });
});

describe('malformed pickles', () => {
  const VALID = buildModelPt();
  const cases: [string, Uint8Array, RegExp][] = [
    ['truncated GLOBAL', hexBytes(0x80, 0x02, 0x63, 0x61), /Unterminated GLOBAL|Truncated/],
    [
      'BINUNICODE past end',
      hexBytes(0x80, 0x02, 0x58, 0xff, 0xff, 0x00, 0x00, 0x61, 0x62),
      /Truncated/,
    ],
    ['MARK underflow', hexBytes(0x80, 0x02, 0x74, 0x2e), /MARK/],
    ['unknown opcode', hexBytes(0x80, 0x02, 0xff), /0xff/],
  ];
  it.each(cases)(
    '%s (unpickle)',
    (_name, bytes, re) => {
      expectSyncParseError(() => unpickle(bytes, hooks()), re);
    },
    2000,
  );
  it.each(cases)(
    '%s (parseModelFile)',
    async (_name, bytes, re) => {
      await expectParseError(() => parse(buildModelPt({ pickle: bytes })), re);
    },
    2000,
  );

  it('missing STOP', async () => {
    // A valid fixture pickle with its final STOP removed; re-derive the valid pickle from the fixture zip: data.pkl is the first entry.
    const dv = new DataView(VALID.buffer);
    const nameLen = dv.getUint16(26, true);
    const size = dv.getUint32(22, true);
    const pkl = VALID.slice(30 + nameLen, 30 + nameLen + size);
    expect(pkl[pkl.length - 1]).toBe(0x2e);
    const noStop = pkl.slice(0, -1);
    expectSyncParseError(() => unpickle(noStop, hooks()), /Truncated/);
    await expectParseError(() => parse(buildModelPt({ pickle: noStop })), /Truncated/);
  }, 2000);
});

describe('malformed zips', () => {
  it('bad EOCD', async () => {
    const z = buildModelPt();
    z.fill(0, z.length - 22);
    await expectParseError(() => parse(z), /^Not a zip file$/);
  }, 2000);

  it('bad zip64 locator signature', async () => {
    await expectParseError(
      () => parse(buildModelPt({ zip: { zip64: true, zip64LocatorSig: 0x12345678 } })),
      /zip64/,
    );
  }, 2000);

  it('bad zip64 EOCD signature', async () => {
    await expectParseError(
      () => parse(buildModelPt({ zip: { zip64: true, zip64EocdSig: 0x12345678 } })),
      /zip64/,
    );
  }, 2000);

  it('cdOffset beyond end', async () => {
    const z = buildModelPt();
    await expectParseError(() => parse(patchEocd(z, { cdOffset: z.length + 10 })));
  }, 2000);

  it('compressed entry', async () => {
    const z = buildModelPt({
      files: (fs) => fs.map((f) => (f.name.endsWith('data.pkl') ? { ...f, method: 8 } : f)),
    });
    await expectParseError(() => parse(z), /^Compressed zip entries are not supported$/);
  }, 2000);

  it('duplicate names', async () => {
    const z = buildModelPt({ files: (fs) => [...fs, fs[0]] });
    await expectParseError(() => parse(z), /Duplicate/);
  }, 2000);

  it('not a torch zip (no data.pkl)', async () => {
    const z = buildModelPt({ files: (fs) => fs.filter((f) => !f.name.endsWith('data.pkl')) });
    await expectParseError(() => parse(z), /data\.pkl/);
  }, 2000);

  it('empty and tiny files', async () => {
    await expectParseError(() => parse(new Uint8Array(0)), /Not a zip file/);
    await expectParseError(() => parse(new Uint8Array(30)), /Not a zip file/);
  }, 2000);
});

describe('malformed tensors', () => {
  it('oversized numel', async () => {
    await expectParseError(() =>
      parse(buildModelPt({ pos: { size: [2 ** 40, 3], stride: [3, 1] } })),
    );
  }, 2000);

  it('storage too short', async () => {
    const pos = new Uint8Array(fixturePos().buffer);
    await expectParseError(() =>
      parse(buildModelPt({ pos: { numel: 12, bytes: pos.slice(0, pos.length - 8) } })),
    );
  }, 2000);

  // A non-contiguous tensor is accepted when built (real files have some on non-graph paths, e.g.
  // sparse voxel-grid indices) but cannot be read: the graph using it becomes unreadable.
  it('stride mismatch makes the graph unreadable', async () => {
    const t0 = performance.now();
    const m = await parse(buildModelPt({ pos: { size: [4, 3], stride: [1, 4] } }));
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(m.lms[0].graphIds).toEqual([]);
    expect(m.lms[0].unreadable).toHaveLength(1);
    expect(m.lms[0].unreadable[0].reason).toMatch(/Non-contiguous tensor/);
  }, 2000);

  it('non-contiguous tensor reaching past its storage', async () => {
    await expectParseError(() => parse(buildModelPt({ pos: { size: [4, 3], stride: [1, 5] } })));
  }, 2000);

  it('offset beyond the storage', async () => {
    await expectParseError(() => parse(buildModelPt({ pos: { offset: 3 } })));
  }, 2000);

  it('unknown storage class is an inert placeholder, not a crash', async () => {
    await expectParseError(() =>
      parse(buildModelPt({ pos: { storageClass: 'ComplexDoubleStorage' } })),
    );
  }, 2000);
});

describe('malformed graphs (non-fatal)', () => {
  it('feature_mapping out of range marks the graph unreadable', async () => {
    const t0 = performance.now();
    const m = await parse(
      buildModelPt({
        featureMapping: { pose_vectors: [0, 9], pose_fully_defined: [9, 10], hsv: [10, 14] },
      }),
    );
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(m.lms[0].graphIds).toEqual([]);
    expect(m.lms[0].unreadable).toHaveLength(1);
    expect(m.lms[0].unreadable[0].graphId).toBe('g');
    expect(m.lms[0].unreadable[0].reason).toMatch(/hsv/);
  }, 2000);

  it('pos with the wrong shape marks the graph unreadable', async () => {
    const m = await parse(buildModelPt({ pos: { size: [3, 4], stride: [4, 1] } }));
    expect(m.lms[0].unreadable[0].reason).toMatch(/pos shape/);
  }, 2000);
});

describe('after malformed inputs', () => {
  it('the default fixture still parses', async () => {
    const m = await parse(buildModelPt());
    expect(m.lms).toHaveLength(1);
    expect(m.lms[0].graphIds).toEqual(['g']);
    expect(m.lms[0].graphs.get('g')!.channels[0].n).toBe(4);
  });
});

const MUG =
  '/home/ramy/tbp/results/monty/pretrained_models/pretrained_ycb_v13/supervised_pre_training_base/pretrained/model.pt';
describe('local fixture', () => {
  it.skipIf(!existsSync(MUG))(
    'legacy supervised_pre_training_base has mug in LM 0',
    async () => {
      const m = await parseModelFile(await openAsBlob(MUG), 'model.pt');
      expect(m.lms[0].graphIds).toContain('mug');
      const c = m.lms[0].graphs.get('mug')!.channels[0];
      expect(c.features.node_ids).toBeUndefined();
      expect(c.n).toBeGreaterThan(0);
    },
    20000,
  );
});
