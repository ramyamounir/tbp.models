import { describe, expect, it } from 'vitest';
import type { ModelFile, ObjectGraph } from '../model/types';
import { validHistoryEntry } from './history';

const g = (lmId: number, graphId: string): ObjectGraph => ({
  lmId,
  graphId,
  channels: [],
  centroid: [0, 0, 0],
});

const model: ModelFile = {
  fileName: 'model.pt',
  byteLength: 1,
  lms: [
    {
      lmId: 0,
      graphIds: ['021_logo_tbp'],
      graphs: new Map([['021_logo_tbp', g(0, '021_logo_tbp')]]),
      unreadable: [],
    },
    {
      lmId: 1,
      graphIds: ['002_cube'],
      graphs: new Map([['002_cube', g(1, '002_cube')]]),
      unreadable: [],
    },
  ],
  lmToLm: [],
  smToLm: [],
  objectIdIndex: new Map(),
};

describe('validHistoryEntry', () => {
  it('accepts an entry naming a graph of the current load', () => {
    expect(validHistoryEntry({ lmId: 0, graphId: '021_logo_tbp', loadGen: 3 }, model, 3)).toEqual({
      lmId: 0,
      graphId: '021_logo_tbp',
      loadGen: 3,
    });
  });

  it.each([
    ['null state', null],
    ['non-object', 'x'],
    ['stale loadGen', { lmId: 0, graphId: '021_logo_tbp', loadGen: 2 }],
    ['lmId out of range', { lmId: 2, graphId: '002_cube', loadGen: 3 }],
    ['negative lmId', { lmId: -1, graphId: '002_cube', loadGen: 3 }],
    ['non-integer lmId', { lmId: 0.5, graphId: '021_logo_tbp', loadGen: 3 }],
    ['graph in another LM', { lmId: 0, graphId: '002_cube', loadGen: 3 }],
    ['non-string graphId', { lmId: 1, graphId: 7, loadGen: 3 }],
    ['prototype key', { lmId: 0, graphId: '__proto__', loadGen: 3 }],
  ])('rejects %s', (_name, state) => {
    expect(validHistoryEntry(state, model, 3)).toBeUndefined();
  });

  it('rejects everything when no model is loaded', () => {
    expect(
      validHistoryEntry({ lmId: 0, graphId: '021_logo_tbp', loadGen: 0 }, undefined, 0),
    ).toBeUndefined();
  });
});
