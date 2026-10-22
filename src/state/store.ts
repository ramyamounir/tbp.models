import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import { graphHasEdgeChannel } from '../model/edges';
import type { ModelFile, ObjectGraph } from '../model/types';
import {
  isTheme,
  readStoredTheme,
  readSystemPrefersDark,
  resolveTheme,
} from '../theme/themeStorage';

export type ColorMode =
  | { kind: 'all' }
  | { kind: 'sm'; feature: 'hsv' | 'rgba' }
  | { kind: 'lm'; feature: 'object_id' }
  | { kind: 'channel' }
  | { kind: 'scalar'; feature: string; component: number }; // colors every channel of the graph that has `feature`

/** 'edges': nodes of 2D-edge channels (src/model/edges.ts) are drawn as segments along their edge tangent. */
export type DisplayAs = 'points' | 'edges';

export interface DisplayOptions {
  pointSize: number;
  showNormals: boolean;
  center: boolean;
  dimOthers: boolean;
  displayAs: DisplayAs;
  /** Edge segment length as a percentage of the object bounding-sphere radius `R`. */
  edgeLengthPct: number;
  /** Edge segment width in CSS px. */
  edgeWidthPx: number;
}
/** The "Display as" settings, shared by the parent graph and the inspector's child object. */
export type DisplayAsOptions = Pick<
  DisplayOptions,
  'displayAs' | 'pointSize' | 'edgeLengthPct' | 'edgeWidthPx'
>;
export type Tool = 'orbit' | 'pan' | 'pick' | 'rotate';
/** Inspector tabs of an LM node; COLOR and DISPLAY style the child object (preview and overlay). */
export type InspectorTab = 'features' | 'color' | 'display';

/** Legends whose rows the user can reorder (color priority) and hide: object_id and channel source. */
export type LegendKind = 'categorical' | 'channel';
/** Row keys (`CategoricalRow.key` / channel name / `DIMMED_KEY`); `order[0]` is drawn on top. */
export interface LegendPrefs {
  order: string[];
  hidden: string[];
}
export type LegendPrefsByKind = Record<LegendKind, LegendPrefs>;
export type Theme = 'light' | 'dark' | 'system';

export interface ViewerState {
  model?: ModelFile;
  loadGen: number; // incremented by every setModel; identifies the current load
  loading?: { stage: 'reading' | 'parsing' | 'building'; pct?: number };
  error?: string;
  lmId: number; // index into model.lms (model.lms[lmId].lmId === lmId)
  graphId?: string; // key of model.lms[lmId].graphs
  selection?: { channel: string; index: number }; // index into that channel's nodes of the current graph
  activeTab?: string; // channel name of the active inspector tab
  colorMode: ColorMode;
  display: DisplayOptions;
  objectRotationDeg: [number, number, number]; // Euler XYZ, degrees
  legend: LegendPrefsByKind; // kept across graph changes (row keys are channel names / ids); reset by setModel
  tool: Tool;
  ortho: boolean;
  overlayChild: boolean;
  inspectorTab: InspectorTab; // kept across nodes; SM nodes always show FEATURES
  /**
   * Coloring and "Display as" of the child object of an LM node (inspector preview and viewport
   * overlay). Kept across nodes and graphs, reset by setModel; validated against each child graph
   * where it is used (`validateColorMode` / `validateDisplayAs`), not here.
   */
  childColorMode: ColorMode;
  childDisplay: DisplayAsOptions;
  theme: Theme; // user choice; single owner
  systemPrefersDark: boolean; // mirrors matchMedia('(prefers-color-scheme: dark)'); written only by ThemeProvider
  resolvedTheme: 'light' | 'dark'; // derived = resolveTheme(theme, systemPrefersDark); never set directly

  setModel(model: ModelFile, lmId: number, graphId: string | undefined): void;
  setLoading(loading: ViewerState['loading']): void;
  setError(error: string | undefined): void;
  selectGraph(lmId: number, graphId: string | undefined): void;
  /** Turns the child overlay off unless `keepOverlay` (stepping to the previous/next node). */
  setSelection(selection: ViewerState['selection'], opts?: { keepOverlay?: boolean }): void;
  setColorMode(mode: ColorMode): void;
  setDisplay(patch: Partial<DisplayOptions>): void;
  setRotation(deg: [number, number, number]): void;
  /** `keys` = the legend rows in their new order (keys not in it keep their place after them). */
  setLegendOrder(kind: LegendKind, keys: string[]): void;
  toggleLegendHidden(kind: LegendKind, key: string): void;
  showAllLegendRows(kind: LegendKind): void;
  setTool(tool: Tool): void;
  setOrtho(ortho: boolean): void;
  setActiveTab(channel: string | undefined): void;
  setOverlayChild(on: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  setChildColorMode(mode: ColorMode): void;
  setChildDisplay(patch: Partial<DisplayAsOptions>): void;
  setTheme(theme: Theme): void;
  setSystemPrefersDark(dark: boolean): void;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  pointSize: 3,
  showNormals: false,
  center: true,
  dimOthers: false,
  displayAs: 'points',
  edgeLengthPct: 8, // tbp.teleop draws ±0.04 × half-extent, i.e. 8 % of the frame half-size
  edgeWidthPx: 2,
};

/** Child object defaults: the overlay pink ("All") drawn as points. */
export const DEFAULT_CHILD_DISPLAY: DisplayAsOptions = {
  displayAs: 'points',
  pointSize: 3,
  edgeLengthPct: DEFAULT_DISPLAY.edgeLengthPct,
  edgeWidthPx: DEFAULT_DISPLAY.edgeWidthPx,
};

const emptyLegendPrefs = (): LegendPrefsByKind => ({
  categorical: { order: [], hidden: [] },
  channel: { order: [], hidden: [] },
});

export const POINT_SIZE_MIN = 1;
export const POINT_SIZE_MAX = 32;
export const EDGE_LENGTH_MIN = 1;
export const EDGE_LENGTH_MAX = 30;
export const EDGE_WIDTH_MIN = 1;
export const EDGE_WIDTH_MAX = 16;

const clampNum = (v: number, lo: number, hi: number, fallback: number) =>
  Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/** `prev` patched with `patch`, numbers clamped to their slider ranges (invalid → previous). */
function patchDisplayAs<T extends DisplayAsOptions>(prev: T, patch: Partial<T>): T {
  const d = { ...prev, ...patch };
  d.pointSize = clampNum(d.pointSize, POINT_SIZE_MIN, POINT_SIZE_MAX, prev.pointSize);
  d.edgeLengthPct = clampNum(d.edgeLengthPct, EDGE_LENGTH_MIN, EDGE_LENGTH_MAX, prev.edgeLengthPct);
  d.edgeWidthPx = clampNum(d.edgeWidthPx, EDGE_WIDTH_MIN, EDGE_WIDTH_MAX, prev.edgeWidthPx);
  if (d.displayAs !== 'points' && d.displayAs !== 'edges') d.displayAs = prev.displayAs;
  return d;
}

/** Graph `graphId` of LM index `lmId`, or undefined. */
export function getGraph(
  model: ModelFile | undefined,
  lmId: number,
  graphId: string | undefined,
): ObjectGraph | undefined {
  if (!model || graphId === undefined) return undefined;
  return model.lms[lmId]?.graphs.get(graphId);
}

function hasFeature(ch: { features: Record<string, [number, number]> }, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(ch.features, name);
}

/** Graph-change color-mode validation (spec Phase 1 "Action semantics and reset rules"). */
export function validateColorMode(mode: ColorMode, g: ObjectGraph | undefined): ColorMode {
  const ALL: ColorMode = { kind: 'all' };
  if (!g) return ALL;
  switch (mode.kind) {
    case 'all':
    case 'channel':
      return mode;
    case 'sm':
      return g.channels.some((c) => c.kind === 'sm' && hasFeature(c, mode.feature)) ? mode : ALL;
    case 'lm':
      return g.channels.some((c) => c.kind === 'lm' && hasFeature(c, 'object_id')) ? mode : ALL;
    case 'scalar': {
      if (mode.feature === 'pose_vectors' || mode.feature === 'object_id') return ALL;
      const ok = g.channels.some((c) => {
        if (!hasFeature(c, mode.feature)) return false;
        const [start, end] = c.features[mode.feature];
        return (
          Number.isInteger(mode.component) && mode.component >= 0 && mode.component < end - start
        );
      });
      return ok ? mode : ALL;
    }
  }
}

/** Graph-change "Display as" validation: 'edges' needs a 2D-edge channel in the new graph. */
export function validateDisplayAs(mode: DisplayAs, g: ObjectGraph | undefined): DisplayAs {
  return mode === 'edges' && graphHasEdgeChannel(g) ? 'edges' : 'points';
}

/** Fields reset whenever the displayed graph changes (setModel / selectGraph). */
function graphChangeResets(
  model: ModelFile | undefined,
  lmId: number,
  graphId: string | undefined,
  colorMode: ColorMode,
  display: DisplayOptions,
): Pick<ViewerState, 'selection' | 'activeTab' | 'overlayChild' | 'colorMode' | 'display'> {
  const g = getGraph(model, lmId, graphId);
  const displayAs = validateDisplayAs(display.displayAs, g);
  return {
    selection: undefined,
    activeTab: undefined,
    overlayChild: false,
    colorMode: validateColorMode(colorMode, g),
    display: displayAs === display.displayAs ? display : { ...display, displayAs },
  };
}

function initialTheme(): Pick<ViewerState, 'theme' | 'systemPrefersDark' | 'resolvedTheme'> {
  const theme = readStoredTheme();
  const systemPrefersDark = readSystemPrefersDark();
  return {
    theme,
    systemPrefersDark,
    resolvedTheme: resolveTheme(theme, systemPrefersDark),
  };
}

export const useViewerStore = create<ViewerState>()(
  subscribeWithSelector((set, get) => ({
    model: undefined,
    loadGen: 0,
    loading: undefined,
    error: undefined,
    lmId: 0,
    graphId: undefined,
    selection: undefined,
    activeTab: undefined,
    colorMode: { kind: 'all' },
    display: { ...DEFAULT_DISPLAY },
    objectRotationDeg: [0, 0, 0],
    legend: emptyLegendPrefs(),
    tool: 'orbit',
    ortho: false,
    overlayChild: false,
    inspectorTab: 'features',
    childColorMode: { kind: 'all' },
    childDisplay: { ...DEFAULT_CHILD_DISPLAY },
    ...initialTheme(),

    setModel(model, lmId, graphId) {
      set((s) => ({
        model,
        lmId,
        graphId,
        loadGen: s.loadGen + 1,
        loading: undefined,
        legend: emptyLegendPrefs(),
        childColorMode: { kind: 'all' },
        childDisplay: { ...DEFAULT_CHILD_DISPLAY },
        error: undefined,
        ...graphChangeResets(model, lmId, graphId, s.colorMode, s.display),
      }));
    },

    setLoading(loading) {
      set({ loading, error: undefined });
    },

    setError(error) {
      set({ error, loading: undefined });
    },

    selectGraph(lmId, graphId) {
      const s = get();
      if (lmId === s.lmId && graphId === s.graphId) return;
      const model = s.model;
      if (!model) return;
      if (!Number.isInteger(lmId) || lmId < 0 || lmId >= model.lms.length) return;
      if (graphId !== undefined && !model.lms[lmId].graphs.has(graphId)) return;
      set({
        lmId,
        graphId,
        ...graphChangeResets(model, lmId, graphId, s.colorMode, s.display),
      });
    },

    setSelection(selection, opts) {
      set((s) => ({
        selection,
        activeTab: selection?.channel,
        overlayChild: !!opts?.keepOverlay && selection !== undefined && s.overlayChild,
      }));
    },

    setColorMode(colorMode) {
      set({ colorMode });
    },

    setDisplay(patch) {
      set((s) => {
        const display = patchDisplayAs(s.display, patch);
        if (
          display.displayAs === 'edges' &&
          !graphHasEdgeChannel(getGraph(s.model, s.lmId, s.graphId))
        )
          display.displayAs = 'points';
        return { display };
      });
    },

    setRotation(deg) {
      set({ objectRotationDeg: [deg[0], deg[1], deg[2]] });
    },

    setLegendOrder(kind, keys) {
      set((s) => {
        const first = [...new Set(keys)];
        const seen = new Set(first);
        const order = [...first, ...s.legend[kind].order.filter((k) => !seen.has(k))];
        return { legend: { ...s.legend, [kind]: { ...s.legend[kind], order } } };
      });
    },

    toggleLegendHidden(kind, key) {
      set((s) => {
        const prev = s.legend[kind].hidden;
        const hidden = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        return { legend: { ...s.legend, [kind]: { ...s.legend[kind], hidden } } };
      });
    },

    showAllLegendRows(kind) {
      set((s) =>
        s.legend[kind].hidden.length === 0
          ? s
          : { legend: { ...s.legend, [kind]: { ...s.legend[kind], hidden: [] } } },
      );
    },

    setTool(tool) {
      set({ tool });
    },

    setOrtho(ortho) {
      set({ ortho });
    },

    setActiveTab(activeTab) {
      if (get().selection === undefined) return;
      set({ activeTab, overlayChild: false });
    },

    setOverlayChild(overlayChild) {
      set({ overlayChild });
    },

    setInspectorTab(inspectorTab) {
      if (inspectorTab !== 'features' && inspectorTab !== 'color' && inspectorTab !== 'display')
        return;
      set({ inspectorTab });
    },

    setChildColorMode(childColorMode) {
      set({ childColorMode });
    },

    setChildDisplay(patch) {
      set((s) => ({ childDisplay: patchDisplayAs(s.childDisplay, patch) }));
    },

    setTheme(theme) {
      if (!isTheme(theme)) return;
      set((s) => ({
        theme,
        resolvedTheme: resolveTheme(theme, s.systemPrefersDark),
      }));
    },

    setSystemPrefersDark(dark) {
      set((s) => ({
        systemPrefersDark: dark,
        resolvedTheme: resolveTheme(s.theme, dark),
      }));
    },
  })),
);
