import { describe, expect, it } from 'vitest';
import type { ChannelGraph, ModelFile, ObjectGraph } from '../model/types';
import type { LegendPrefsByKind } from '../state/store';
import {
  applyLegendOrder,
  CHILD_CATEGORICAL,
  computeColoring,
  DIMMED_KEY,
  type ThemeColors,
} from './colors';

const theme: ThemeColors = {
  pointDefault: [0.5, 0.5, 0.5],
  dim: [0.6, 0.6, 0.6],
  sm: [0, 0.5, 0.7],
  lm: [0.6, 0.2, 0.9],
};

/** Channel with one feature column per entry of `values` (row i = values[i]). */
function channel(name: string, kind: 'sm' | 'lm', feature: string, values: number[]): ChannelGraph {
  const n = values.length;
  return {
    channel: name,
    kind,
    n,
    pos: new Float64Array(n * 3),
    x: Float64Array.from(values),
    F: 1,
    features: { [feature]: [0, 1] },
    nonFiniteRows: 0,
  };
}

const graph: ObjectGraph = {
  lmId: 2,
  graphId: 'cube',
  channels: [
    channel('patch_0', 'sm', 'on_object', [1, 1]),
    channel('learning_module_1', 'lm', 'object_id', [7, 8]),
    channel('learning_module_0', 'lm', 'object_id', [7, NaN, 7]),
  ],
  centroid: [0, 0, 0],
};

const model: ModelFile = {
  fileName: 'model.pt',
  byteLength: 1,
  lms: [],
  lmToLm: [],
  smToLm: [],
  objectIdIndex: new Map(),
};

const prefs = (p: Partial<LegendPrefsByKind>): LegendPrefsByKind => ({
  categorical: { order: [], hidden: [] },
  channel: { order: [], hidden: [] },
  ...p,
});

const key = (ch: string, id: number) => `${ch}\u0000${id}`;

describe('applyLegendOrder', () => {
  it('puts listed keys first in order, unlisted after in natural order', () => {
    expect(applyLegendOrder(['a', 'b', 'c', 'd'], (x) => x, ['c', 'zz', 'a'])).toEqual([
      'c',
      'a',
      'b',
      'd',
    ]);
  });
});

describe('computeColoring legend priority and hiding', () => {
  it('ranks categorical rows by legend order; dimmed nodes get priority 0', () => {
    const c = computeColoring(model, graph, { kind: 'lm', feature: 'object_id' }, theme);
    const legend = c.legend!;
    expect(legend.kind).toBe('categorical');
    if (legend.kind !== 'categorical') return;
    expect(legend.rows.map((r) => r.key)).toEqual([
      key('learning_module_1', 7),
      key('learning_module_1', 8),
      key('learning_module_0', 7),
    ]);
    expect([...c.channels[0].priority]).toEqual([0, 0]); // SM channel: dimmed
    expect([...c.channels[1].priority]).toEqual([3, 2]);
    expect([...c.channels[2].priority]).toEqual([1, 0, 1]); // NaN id: dimmed

    const reordered = computeColoring(
      model,
      graph,
      { kind: 'lm', feature: 'object_id' },
      theme,
      prefs({ categorical: { order: [key('learning_module_0', 7)], hidden: [] } }),
    );
    expect([...reordered.channels[2].priority]).toEqual([3, 0, 3]);
    expect([...reordered.channels[1].priority]).toEqual([2, 1]);
    // Colors follow the row, not its rank.
    expect(reordered.channels[2].colors).toEqual(c.channels[2].colors);
  });

  it('colors categorical rows from the given palette', () => {
    const c = computeColoring(
      model,
      graph,
      { kind: 'lm', feature: 'object_id' },
      theme,
      undefined,
      CHILD_CATEGORICAL,
    );
    const legend = c.legend!;
    if (legend.kind !== 'categorical') throw new Error('expected categorical');
    expect(legend.rows.map((r) => r.color)).toEqual(CHILD_CATEGORICAL.slice(0, 3));
  });

  it('hides categorical rows and the dimmed row', () => {
    const c = computeColoring(
      model,
      graph,
      { kind: 'lm', feature: 'object_id' },
      theme,
      prefs({ categorical: { order: [], hidden: [key('learning_module_1', 8), DIMMED_KEY] } }),
    );
    expect([...c.channels[0].hidden]).toEqual([1, 1]);
    expect([...c.channels[1].hidden]).toEqual([0, 1]);
    expect([...c.channels[2].hidden]).toEqual([0, 1, 0]);
    const legend = c.legend!;
    if (legend.kind !== 'categorical') throw new Error('expected categorical');
    expect(legend.dimmedHidden).toBe(true);
    expect(legend.rows.map((r) => r.hidden)).toEqual([false, true, false]);
  });

  it('ranks and hides channels in channel-source mode', () => {
    const c = computeColoring(
      model,
      graph,
      { kind: 'channel' },
      theme,
      prefs({ channel: { order: ['learning_module_0'], hidden: ['patch_0'] } }),
    );
    const legend = c.legend!;
    if (legend.kind !== 'channel') throw new Error('expected channel');
    expect(legend.rows.map((r) => [r.channel, r.hidden])).toEqual([
      ['learning_module_0', false],
      ['patch_0', true],
      ['learning_module_1', false],
    ]);
    expect(c.channels.map((cc) => cc.priority[0])).toEqual([2, 1, 3]);
    expect([...c.channels[0].hidden]).toEqual([1, 1]);
  });

  it('draws colored nodes above dimmed ones in scalar mode', () => {
    const c = computeColoring(
      model,
      graph,
      { kind: 'scalar', feature: 'object_id', component: 0 },
      theme,
    );
    expect([...c.channels[0].priority]).toEqual([0, 0]);
    expect([...c.channels[2].priority]).toEqual([1, 0, 1]);
  });
});
