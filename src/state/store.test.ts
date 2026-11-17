import { beforeEach, describe, expect, it } from 'vitest';
import { testOrder, testOrigin } from '../loader/testFixture';
import type { ChannelGraph, ModelFile, ObjectGraph } from '../model/types';
import { stepNode } from './keyboard';
import { DEFAULT_CHILD_DISPLAY, DEFAULT_DISPLAY, useViewerStore, validateColorMode } from './store';

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
  return { lmId, graphId, channels, centroid: [0, 0, 0], origin: testOrigin(lmId), patches: [] };
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
      order: testOrder(['mug']),
    },
    {
      lmId: 1,
      graphIds: ['cube'],
      graphs: new Map([['cube', twoCh]]),
      unreadable: [],
      order: testOrder(['cube']),
    },
    {
      lmId: 2,
      graphIds: ['logo'],
      graphs: new Map([['logo', edge2d]]),
      unreadable: [],
      order: testOrder(['logo']),
    },
  ],
  lmToLm: [],
  smToLm: [],
  objectIdIndex: new Map(),
};

const initial = useViewerStore.getState();

/** Opens `model` as a new file and selects `graphId` of LM `lmId`. */
function openModel(lmId: number, graphId: string): void {
  useViewerStore.getState().openFile(new File([], 'model.pt'), model);
  useViewerStore.getState().selectGraph(lmId, graphId);
}
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

describe('openFile / selectGraph', () => {
  it('openFile stores atomically, bumps loadGen and clears loading/error/selection', () => {
    const s = useViewerStore.getState();
    s.setLoading({ stage: 'parsing' });
    openModel(1, 'cube');
    let st = useViewerStore.getState();
    expect(st.loadGen).toBe(1);
    expect(st.lmId).toBe(1);
    expect(st.graphId).toBe('cube');
    expect(st.loading).toBeUndefined();
    st.setSelection({ channel: 'patch_1', index: 0 });
    st.setOverlayChild(true);
    openModel(0, 'mug');
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
    openModel(0, 'mug');
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
    openModel(1, 'cube');
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

  it('stepping to the next node keeps the child overlay on; picking a node turns it off', () => {
    const s = useViewerStore.getState();
    openModel(1, 'cube');
    s.setSelection({ channel: 'learning_module_0', index: 0 });
    s.setOverlayChild(true);
    expect(stepNode(useViewerStore.getState(), 1)).toBe(true);
    expect(useViewerStore.getState()).toMatchObject({
      selection: { channel: 'learning_module_0', index: 1 },
      overlayChild: true,
    });
    s.setSelection({ channel: 'learning_module_0', index: 0 });
    expect(useViewerStore.getState().overlayChild).toBe(false);
  });

  it('clamps pointSize to 1..32, edgeLengthPct to 1..30 and edgeWidthPx to 1..16', () => {
    const s = useViewerStore.getState();
    s.setDisplay({ pointSize: 50 });
    expect(useViewerStore.getState().display.pointSize).toBe(32);
    s.setDisplay({ pointSize: 0 });
    expect(useViewerStore.getState().display.pointSize).toBe(1);
    s.setDisplay({ pointSize: NaN });
    expect(useViewerStore.getState().display.pointSize).toBe(1);
    s.setDisplay({ center: false });
    expect(useViewerStore.getState().display).toMatchObject({
      pointSize: 1,
      center: false,
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
    openModel(2, 'logo');
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

describe('legend prefs', () => {
  it('reorders, toggles hidden and shows all; kept across graphs, reset by openFile', () => {
    const s = useViewerStore.getState();
    openModel(1, 'cube');
    s.setLegendOrder('channel', ['b', 'a']);
    s.setLegendOrder('channel', ['c', 'a']); // keys not given keep their place after
    expect(useViewerStore.getState().legend.channel.order).toEqual(['c', 'a', 'b']);
    s.toggleLegendHidden('categorical', 'x');
    s.toggleLegendHidden('categorical', 'y');
    s.toggleLegendHidden('categorical', 'x');
    expect(useViewerStore.getState().legend.categorical.hidden).toEqual(['y']);
    expect(useViewerStore.getState().legend.channel.hidden).toEqual([]);
    s.selectGraph(0, 'mug');
    expect(useViewerStore.getState().legend.categorical.hidden).toEqual(['y']);
    s.showAllLegendRows('categorical');
    expect(useViewerStore.getState().legend.categorical.hidden).toEqual([]);
    openModel(1, 'cube');
    expect(useViewerStore.getState().legend.channel.order).toEqual([]);
  });
});

describe('match radius', () => {
  it('defaults to 2 % of R, clamps to 0..10 and survives openFile', () => {
    const s = useViewerStore.getState();
    expect(s.matchRadiusPct).toBe(2);
    s.setMatchRadiusPct(50);
    expect(useViewerStore.getState().matchRadiusPct).toBe(10);
    s.setMatchRadiusPct(-1);
    expect(useViewerStore.getState().matchRadiusPct).toBe(0);
    s.setMatchRadiusPct(NaN);
    expect(useViewerStore.getState().matchRadiusPct).toBe(0);
    s.setMatchRadiusPct(3.5);
    openModel(1, 'cube');
    expect(useViewerStore.getState().matchRadiusPct).toBe(3.5);
  });
});

describe('child settings and inspector tab', () => {
  it('default to All / points / FEATURES; kept across graphs, reset by openFile', () => {
    const s = useViewerStore.getState();
    expect(s.childColorMode).toEqual({ kind: 'all' });
    expect(s.childDisplay).toEqual(DEFAULT_CHILD_DISPLAY);
    expect(s.inspectorTab).toBe('features');
    openModel(1, 'cube');
    s.setChildColorMode({ kind: 'sm', feature: 'hsv' });
    s.setChildDisplay({ displayAs: 'edges', edgeWidthPx: 99, pointSize: 0 });
    s.setInspectorTab('color');
    s.setInspectorTab('bogus' as never);
    s.selectGraph(0, 'mug'); // not validated here: each child graph is checked where it is drawn
    let st = useViewerStore.getState();
    expect(st.childColorMode).toEqual({ kind: 'sm', feature: 'hsv' });
    expect(st.childDisplay).toMatchObject({ displayAs: 'edges', edgeWidthPx: 16, pointSize: 1 });
    expect(st.inspectorTab).toBe('color');
    openModel(1, 'cube');
    st = useViewerStore.getState();
    expect(st.childColorMode).toEqual({ kind: 'all' });
    expect(st.childDisplay).toEqual(DEFAULT_CHILD_DISPLAY);
  });
});

describe('renameFile', () => {
  const names = () => useViewerStore.getState().files.map((f) => f.name);

  it('renames in the app only and keeps names unique', () => {
    openModel(0, 'a');
    openModel(0, 'a');
    expect(names()).toEqual(['model.pt', 'model.pt (2)']);
    const [first, second] = useViewerStore.getState().files;
    useViewerStore.getState().renameFile(second.id, '  baseline\u202E ');
    expect(names()).toEqual(['model.pt', 'baseline']);
    let st = useViewerStore.getState();
    expect(st.files[1].renamed).toBe(true);
    expect(st.files[1].file.name).toBe('model.pt');
    expect(st.sourceFiles.get(second.id)?.name).toBe('baseline');
    expect(st.files[1].undo).toEqual([]);
    // A name another open file has gets a suffix; an empty name is ignored.
    st.renameFile(first.id, 'baseline');
    st.renameFile(second.id, '   ');
    expect(names()).toEqual(['baseline (2)', 'baseline']);
    // The on-disk name is free again for the next file.
    openModel(0, 'a');
    st = useViewerStore.getState();
    expect(names()).toEqual(['baseline (2)', 'baseline', 'model.pt']);
    expect(st.files[2].renamed).toBeUndefined();
  });
});

describe('pose options', () => {
  it('are off by default and clamp the length', () => {
    const s = useViewerStore.getState();
    expect(s.pose).toEqual({
      show: false,
      sm: true,
      lm: true,
      smRows: [true, false, false],
      smDefinedOnly: false,
      lmRows: [false, false, false],
      lengthPct: 5,
      widthPx: 1,
    });
    s.setPose({ show: true, lengthPct: 500, smRows: [true, true, false] });
    expect(useViewerStore.getState().pose).toMatchObject({
      show: true,
      lengthPct: 30,
      smRows: [true, true, false],
    });
    s.setPose({ widthPx: 99 });
    expect(useViewerStore.getState().pose.widthPx).toBe(8);
    s.setPose({ lengthPct: NaN });
    expect(useViewerStore.getState().pose.lengthPct).toBe(30);
  });
});

describe('child pose options', () => {
  it('are separate from the displayed graph and reset with the file', () => {
    openModel(0, 'a');
    const s = useViewerStore.getState();
    s.setInspectorTab('pose');
    s.setChildPose({ show: true, widthPx: 99 });
    let st = useViewerStore.getState();
    expect(st.inspectorTab).toBe('pose');
    expect(st.childPose).toMatchObject({ show: true, widthPx: 8 });
    expect(st.pose.show).toBe(false);
    openModel(0, 'a');
    st = useViewerStore.getState();
    expect(st.childPose.show).toBe(false);
  });
});
