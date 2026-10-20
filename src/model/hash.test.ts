import { afterEach, describe, expect, it, vi } from 'vitest';
import { bottomUpSenders, buildObjectIdIndex, resolveObjectId, sha256_24, sumOrd } from './hash';
import type { ChannelGraph, LmEntry, ModelFile, ObjectGraph } from './types';

function channel(name: string): ChannelGraph {
  return {
    channel: name,
    kind: name.startsWith('learning_module_') ? 'lm' : 'sm',
    n: 0,
    pos: new Float64Array(0),
    x: new Float64Array(0),
    F: 1,
    features: { object_id: [0, 1] },
    nonFiniteRows: 0,
  };
}

function lm(lmId: number, graphs: Record<string, string[]>): LmEntry {
  const map = new Map<string, ObjectGraph>();
  for (const [graphId, chans] of Object.entries(graphs)) {
    map.set(graphId, { lmId, graphId, channels: chans.map(channel), centroid: [0, 0, 0] });
  }
  return { lmId, graphIds: Object.keys(graphs), graphs: map, unreadable: [] };
}

async function model(lms: LmEntry[]): Promise<ModelFile> {
  return {
    fileName: 'x.pt',
    byteLength: 0,
    lms,
    lmToLm: [],
    smToLm: [],
    objectIdIndex: await buildObjectIdIndex(lms),
  };
}

// 3 LMs: LM 0 has 005_x; LM 1 has the sum(ord) collision pair; LM 2 receives from LM 0.
const threeLm = () =>
  model([
    lm(0, { '005_x': ['patch_0'], '001_cube': ['patch_0'] }),
    lm(1, {
      '010_disk_numenta_vert': ['patch_1', 'learning_module_0'],
      '013_cylinder_tbp_vert': ['patch_1', 'learning_module_0'],
      '021_logo_tbp': ['patch_1'],
    }),
    lm(2, { big: ['patch_2', 'learning_module_0'] }),
  ]);

describe('object_id hashes', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('computes known sumOrd values', () => {
    expect(sumOrd('001_cube')).toBe(655);
    expect(sumOrd('021_logo_tbp')).toBe(1096);
    expect(sumOrd('010_disk_numenta_vert')).toBe(2066);
    expect(sumOrd('013_cylinder_tbp_vert')).toBe(2066);
  });

  const SHA = [
    ['001_cube', 5907713],
    ['021_logo_tbp', 6541108],
    ['010_disk_numenta_vert', 9031499],
    ['013_cylinder_tbp_vert', 1802583],
  ] as const;

  it('computes known sha256_24 values with crypto.subtle', async () => {
    for (const [name, id] of SHA) expect(await sha256_24(name)).toBe(id);
  });

  it('computes identical sha256_24 values without crypto.subtle (pure-JS fallback)', async () => {
    vi.stubGlobal('crypto', {});
    expect(globalThis.crypto.subtle).toBeUndefined();
    for (const [name, id] of SHA) expect(await sha256_24(name)).toBe(id);
  });
});

describe('resolveObjectId', () => {
  it('reports a same-LM sum(ord) collision as ambiguous, sorted by graphId', async () => {
    const m = await threeLm();
    const r = resolveObjectId(m, 'learning_module_1', 2066);
    expect(r).toEqual({
      status: 'ambiguous',
      lmId: 1,
      candidates: [
        { graphId: '010_disk_numenta_vert', encoding: 'sumOrd' },
        { graphId: '013_cylinder_tbp_vert', encoding: 'sumOrd' },
      ],
    });
  });

  it('resolves the colliding graphs uniquely by their SHA-256 ids', async () => {
    const m = await threeLm();
    expect(resolveObjectId(m, 'learning_module_1', 9031499)).toEqual({
      status: 'resolved',
      lmId: 1,
      graphId: '010_disk_numenta_vert',
      encoding: 'sha256',
    });
    expect(resolveObjectId(m, 'learning_module_1', 1802583)).toEqual({
      status: 'resolved',
      lmId: 1,
      graphId: '013_cylinder_tbp_vert',
      encoding: 'sha256',
    });
    expect(resolveObjectId(m, 'learning_module_1', 1096)).toMatchObject({
      status: 'resolved',
      graphId: '021_logo_tbp',
    });
  });

  it('resolves only against the LM named by the channel (no fallback)', async () => {
    const m = await threeLm();
    const id = sumOrd('005_x');
    expect(resolveObjectId(m, 'learning_module_0', id)).toEqual({
      status: 'resolved',
      lmId: 0,
      graphId: '005_x',
      encoding: 'sumOrd',
    });
    expect(resolveObjectId(m, 'learning_module_1', id)).toEqual({ status: 'unresolved', id });
  });

  it('treats malformed channels and ids as unresolved', async () => {
    const m = await threeLm();
    expect(resolveObjectId(m, 'patch_1', 655).status).toBe('unresolved');
    expect(resolveObjectId(m, 'learning_module_7', 655).status).toBe('unresolved');
    expect(resolveObjectId(m, 'learning_module_x', 655).status).toBe('unresolved');
    expect(resolveObjectId(m, 'learning_module_0', NaN).status).toBe('unresolved');
    expect(resolveObjectId(m, 'learning_module_1', 2066.4)).toEqual({
      status: 'unresolved',
      id: 2066.4,
    });
  });

  it('accepts float ids within 1e-6 of an integer', async () => {
    const m = await threeLm();
    expect(resolveObjectId(m, 'learning_module_0', 655.0000001)).toMatchObject({
      status: 'resolved',
      graphId: '001_cube',
    });
  });
});

describe('buildObjectIdIndex', () => {
  it('has an entry for every LM and de-duplicates (graphId, encoding)', async () => {
    const m = await model([lm(0, { a: ['patch'] }), lm(1, {})]);
    expect([...m.objectIdIndex.keys()]).toEqual([0, 1]);
    expect(m.objectIdIndex.get(1)!.size).toBe(0);
    expect(m.objectIdIndex.get(0)!.get(sumOrd('a'))).toEqual([
      { graphId: 'a', encoding: 'sumOrd' },
    ]);
  });
});

describe('bottomUpSenders', () => {
  it('lists the learning_module_<s> sources of an LM', async () => {
    const m = await threeLm();
    expect(bottomUpSenders(m, 2)).toEqual([0]);
    expect(bottomUpSenders(m, 1)).toEqual([0]);
    expect(bottomUpSenders(m, 0)).toEqual([]);
    expect(bottomUpSenders(m, 9)).toEqual([]);
  });
});
