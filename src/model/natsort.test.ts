import { describe, expect, it } from 'vitest';
import { naturalCompare, sortedGraphIds } from './natsort';
import type { LmEntry } from './types';

describe('naturalCompare', () => {
  it('orders digit runs as numbers', () => {
    const ids = ['obj_10', 'obj_2', 'obj_1', '012_cylinder', '2_cube', '001_cube', 'Mug', 'mug'];
    expect(ids.slice().sort(naturalCompare)).toEqual([
      '001_cube',
      '2_cube',
      '012_cylinder',
      'mug',
      'Mug',
      'obj_1',
      'obj_2',
      'obj_10',
    ]);
  });

  it('is a total order for names that differ only in leading zeros', () => {
    expect(naturalCompare('a01', 'a1')).not.toBe(0);
    expect(naturalCompare('a01', 'a1')).toBe(-naturalCompare('a1', 'a01'));
  });
});

describe('sortedGraphIds', () => {
  it('sorts a copy and leaves the on-disk order alone', () => {
    const lm = { graphIds: ['b10', 'b9', 'a'] } as LmEntry;
    expect(sortedGraphIds(lm)).toEqual(['a', 'b9', 'b10']);
    expect(lm.graphIds).toEqual(['b10', 'b9', 'a']);
    expect(sortedGraphIds(lm)).toBe(sortedGraphIds(lm));
  });
});
