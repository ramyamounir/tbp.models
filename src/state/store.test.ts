import { beforeEach, describe, expect, it } from 'vitest';
import type { ChannelGraph, ModelFile, ObjectGraph } from '../model/types';
import { DEFAULT_DISPLAY, useViewerStore, validateColorMode } from './store';

function channel(
  name: string,
  kind: 'sm' | 'lm',
  features: Record<string, [number, number]>,
): ChannelGraph {
  return {
    channel: name,
    kind,
    n: 2,
    pos: new Float64Array(6),
    x: new Float64Array(0),
    F: 0,
    features,
    nonFiniteRows: 0,
  };
}

function graph(lmId: number, graphId: string, channels: ChannelGraph[]): ObjectGraph {
  return { lmId, graphId, channels, centroid: [0, 0, 0] };
}

const smOnly = graph(0, 'mug', [
  channel('patch_0', 'sm', {
    pose_vectors: [0, 9],
    hsv: [11, 14],
    principal_curvatures_log: [9, 11],
  }),
]);
const twoCh = graph(1, 'cube', [
  channel('patch_1', 'sm', { pose_vectors: [0, 9], hsv: [11, 14] }),
  channel('learning_module_0', 'lm', {
    pose_vectors: [0, 9],
    object_id: [11, 12],
    on_object: [10, 11],
  }),
]);

const edge2d = graph(2, 'logo', [
  channel('patch_0', 'sm', {
    pose_vectors: [0, 9],
    pose_fully_defined: [9, 10],
    hsv: [18, 21],
    edge_strength: [23, 24],
    coherence: [24, 25],
  }),
]);

const model: ModelFile = {
  fileName: 'model.pt',
  byteLength: 1,
  lms: [
    {
      lmId: 0,
      graphIds: ['mug'],
      graphs: new Map([['mug', smOnly]]),
      unreadable: [],
    },
    {
      lmId: 1,
      graphIds: ['cube'],
      graphs: new Map([['cube', twoCh]]),
      unreadable: [],
    },
    {
      lmId: 2,
      graphIds: ['logo'],
      graphs: new Map([['logo', edge2d]]),
      unreadable: [],
    },
  ],
  lmToLm: [],
  smToLm: [],
  objectIdIndex: new Map(),
};

const initial = useViewerStore.getState();
beforeEach(() => useViewerStore.setState(initial, true));

describe('store defaults', () => {
  it('has the specified defaults', () => {
    const s = useViewerStore.getState();
    expect(s.loadGen).toBe(0);
    expect(s.lmId).toBe(0);
    expect(s.graphId).toBeUndefined();
    expect(s.colorMode).toEqual({ kind: 'all' });
    expect(s.display).toEqual(DEFAULT_DISPLAY);
    expect(s.display).toEqual({
      pointSize: 3,
      showNormals: false,
      center: true,
      dimOthers: false,
      displayAs: 'points',
      edgeLengthPct: 8,
      edgeWidthPx: 2,
    });
    expect(s.objectRotationDeg).toEqual([0, 0, 0]);
    expect(s.tool).toBe('orbit');
    expect(s.ortho).toBe(false);
    expect(s.overlayChild).toBe(false);
    expect(s.theme).toBe('system'); // no localStorage in the node test env
    expect(s.resolvedTheme).toBe('light'); // no matchMedia
  });
});

describe('setModel / selectGraph', () => {
  it('setModel stores atomically, bumps loadGen and clears loading/error/selection', () => {
    const s = useViewerStore.getState();
    s.setLoading({ stage: 'parsing' });
    s.setModel(model, 1, 'cube');
    let st = useViewerStore.getState();
    expect(st.loadGen).toBe(1);
    expect(st.lmId).toBe(1);
    expect(st.graphId).toBe('cube');
    expect(st.loading).toBeUndefined();
    st.setSelection({ channel: 'patch_1', index: 0 });
    st.setOverlayChild(true);
    st.setModel(model, 0, 'mug');
    st = useViewerStore.getState();
    expect(st.loadGen).toBe(2);
    expect(st.selection).toBeUndefined();
    expect(st.activeTab).toBeUndefined();
    expect(st.overlayChild).toBe(false);
  });

  it('selectGraph ignores invalid targets and no-ops', () => {
    const s = useViewerStore.getState();
    s.selectGraph(1, 'cube'); // no model
    expect(useViewerStore.getState().graphId).toBeUndefined();
    s.setModel(model, 0, 'mug');
    s.selectGraph(5, undefined);
    s.selectGraph(0, 'cube');
    expect(useViewerStore.getState()).toMatchObject({
      lmId: 0,
      graphId: 'mug',
    });
    s.selectGraph(1, 'cube');
    expect(useViewerStore.getState()).toMatchObject({
      lmId: 1,
      graphId: 'cube',
    });
  });

  it('validates colorMode against the new graph', () => {
    const s = useViewerStore.getState();
    s.setModel(model, 1, 'cube');
    s.setColorMode({ kind: 'lm', feature: 'object_id' });
    s.selectGraph(0, 'mug');
    expect(useViewerStore.getState().colorMode).toEqual({ kind: 'all' });
    s.setColorMode({ kind: 'sm', feature: 'hsv' });
    s.selectGraph(1, 'cube');
    expect(useViewerStore.getState().colorMode).toEqual({
      kind: 'sm',
      feature: 'hsv',
    });
  });

  it('validateColorMode scalar rules', () => {
    expect(
      validateColorMode(
        { kind: 'scalar', feature: 'principal_curvatures_log', component: 1 },
        smOnly,
      ),
    ).toEqual({
      kind: 'scalar',
      feature: 'principal_curvatures_log',
      component: 1,
    });
    expect(
      validateColorMode(
        { kind: 'scalar', feature: 'principal_curvatures_log', component: 2 },
        smOnly,
      ),
    ).toEqual({ kind: 'all' });
    expect(
      validateColorMode({ kind: 'scalar', feature: 'pose_vectors', component: 0 }, smOnly),
    ).toEqual({ kind: 'all' });
    expect(
      validateColorMode({ kind: 'scalar', feature: 'object_id', component: 0 }, twoCh),
    ).toEqual({ kind: 'all' });
    expect(
      validateColorMode({ kind: 'scalar', feature: 'on_object', component: 0 }, twoCh),
    ).toMatchObject({ kind: 'scalar' });
    expect(validateColorMode({ kind: 'channel' }, undefined)).toEqual({
      kind: 'all',
    });
    expect(validateColorMode({ kind: 'channel' }, smOnly)).toEqual({
      kind: 'channel',
    });
  });
});

describe('selection, tabs, display, theme', () => {
  it('setSelection / setActiveTab semantics', () => {
    const s = useViewerStore.getState();
    s.setActiveTab('patch_1'); // no selection -> no-op
    expect(useViewerStore.getState().activeTab).toBeUndefined();
    s.setSelection({ channel: 'patch_1', index: 3 });
    expect(useViewerStore.getState().activeTab).toBe('patch_1');
    s.setOverlayChild(true);
    s.setActiveTab('learning_module_0');
    expect(useViewerStore.getState()).toMatchObject({
      activeTab: 'learning_module_0',
      overlayChild: false,
      selection: { channel: 'patch_1', index: 3 },
    });
    s.setSelection(undefined);
    expect(useViewerStore.getState().activeTab).toBeUndefined();
  });

  it('clamps pointSize to 1..32, edgeLengthPct to 1..30 and edgeWidthPx to 1..16', () => {
    const s = useViewerStore.getState();
    s.setDisplay({ pointSize: 50 });
    expect(useViewerStore.getState().display.pointSize).toBe(32);
    s.setDisplay({ pointSize: 0 });
    expect(useViewerStore.getState().display.pointSize).toBe(1);
    s.setDisplay({ pointSize: NaN });
    expect(useViewerStore.getState().display.pointSize).toBe(1);
    s.setDisplay({ showNormals: true });
    expect(useViewerStore.getState().display).toMatchObject({
      pointSize: 1,
      showNormals: true,
    });
    s.setDisplay({ edgeLengthPct: 100 });
    expect(useViewerStore.getState().display.edgeLengthPct).toBe(30);
    s.setDisplay({ edgeLengthPct: -1 });
    expect(useViewerStore.getState().display.edgeLengthPct).toBe(1);
    s.setDisplay({ edgeWidthPx: 99 });
    expect(useViewerStore.getState().display.edgeWidthPx).toBe(16);
    s.setDisplay({ edgeWidthPx: 0 });
    expect(useViewerStore.getState().display.edgeWidthPx).toBe(1);
  });

  it('allows displayAs "edges" only while the graph has a 2D-edge channel', () => {
    const s = useViewerStore.getState();
    s.setDisplay({ displayAs: 'edges' }); // no model → no edge channel
    expect(useViewerStore.getState().display.displayAs).toBe('points');
    s.setModel(model, 2, 'logo');
    s.setDisplay({ displayAs: 'edges' });
    expect(useViewerStore.getState().display.displayAs).toBe('edges');
    s.setDisplay({ displayAs: 'bogus' as never });
    expect(useViewerStore.getState().display.displayAs).toBe('edges');
    s.selectGraph(1, 'cube'); // 3D graph: falls back to points
    expect(useViewerStore.getState().display.displayAs).toBe('points');
    s.selectGraph(2, 'logo');
    expect(useViewerStore.getState().display.displayAs).toBe('points'); // not re-enabled on its own
  });

  it('derives resolvedTheme and ignores invalid themes', () => {
    const s = useViewerStore.getState();
    s.setTheme('dark');
    expect(useViewerStore.getState().resolvedTheme).toBe('dark');
    s.setTheme('system');
    expect(useViewerStore.getState().resolvedTheme).toBe('light');
    s.setSystemPrefersDark(true);
    expect(useViewerStore.getState().resolvedTheme).toBe('dark');
    s.setTheme('Dark' as never);
    expect(useViewerStore.getState().theme).toBe('system');
  });
});
