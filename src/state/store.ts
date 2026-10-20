import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
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

export interface DisplayOptions {
  pointSize: number;
  showNormals: boolean;
  center: boolean;
  dimOthers: boolean;
}
export type Tool = 'orbit' | 'pan' | 'pick' | 'rotate';
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
  tool: Tool;
  ortho: boolean;
  overlayChild: boolean;
  theme: Theme; // user choice; single owner
  systemPrefersDark: boolean; // mirrors matchMedia('(prefers-color-scheme: dark)'); written only by ThemeProvider
  resolvedTheme: 'light' | 'dark'; // derived = resolveTheme(theme, systemPrefersDark); never set directly

  setModel(model: ModelFile, lmId: number, graphId: string | undefined): void;
  setLoading(loading: ViewerState['loading']): void;
  setError(error: string | undefined): void;
  selectGraph(lmId: number, graphId: string | undefined): void;
  setSelection(selection: ViewerState['selection']): void;
  setColorMode(mode: ColorMode): void;
  setDisplay(patch: Partial<DisplayOptions>): void;
  setRotation(deg: [number, number, number]): void;
  setTool(tool: Tool): void;
  setOrtho(ortho: boolean): void;
  setActiveTab(channel: string | undefined): void;
  setOverlayChild(on: boolean): void;
  setTheme(theme: Theme): void;
  setSystemPrefersDark(dark: boolean): void;
}

export const DEFAULT_DISPLAY: DisplayOptions = {
  pointSize: 3,
  showNormals: false,
  center: true,
  dimOthers: false,
};

const POINT_SIZE_MIN = 1;
const POINT_SIZE_MAX = 8;

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

/** Fields reset whenever the displayed graph changes (setModel / selectGraph). */
function graphChangeResets(
  model: ModelFile | undefined,
  lmId: number,
  graphId: string | undefined,
  colorMode: ColorMode,
): Pick<ViewerState, 'selection' | 'activeTab' | 'overlayChild' | 'colorMode'> {
  return {
    selection: undefined,
    activeTab: undefined,
    overlayChild: false,
    colorMode: validateColorMode(colorMode, getGraph(model, lmId, graphId)),
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
    tool: 'orbit',
    ortho: false,
    overlayChild: false,
    ...initialTheme(),

    setModel(model, lmId, graphId) {
      set((s) => ({
        model,
        lmId,
        graphId,
        loadGen: s.loadGen + 1,
        loading: undefined,
        error: undefined,
        ...graphChangeResets(model, lmId, graphId, s.colorMode),
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
        ...graphChangeResets(model, lmId, graphId, s.colorMode),
      });
    },

    setSelection(selection) {
      set({ selection, activeTab: selection?.channel, overlayChild: false });
    },

    setColorMode(colorMode) {
      set({ colorMode });
    },

    setDisplay(patch) {
      set((s) => {
        const display = { ...s.display, ...patch };
        if (!Number.isFinite(display.pointSize)) display.pointSize = s.display.pointSize;
        display.pointSize = Math.min(POINT_SIZE_MAX, Math.max(POINT_SIZE_MIN, display.pointSize));
        return { display };
      });
    },

    setRotation(deg) {
      set({ objectRotationDeg: [deg[0], deg[1], deg[2]] });
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
