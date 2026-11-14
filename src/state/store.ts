import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { NodeClass } from '../diff/compare';
import {
  DEFAULT_DIFF_SETTINGS,
  patchDiffSettings,
  type DiffPropertyKey,
  type DiffSettings,
} from '../diff/settings';
import { mapAddress, mapLm, type EditRecord } from '../edit/types';
import { graphHasEdgeChannel } from '../model/edges';
import type { ModelFile, ObjectGraph } from '../model/types';
import { pruneSourceFiles, type SourceFile } from './sourceFiles';
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

/** One open model.pt (spec multi-file-edit-diff Phase 1 "Store"). */
export interface OpenFile {
  id: string; // crypto.randomUUID()
  file: File; // handle, re-read at export
  name: string; // display name, "model.pt (2)" for a repeated name
  byteLength: number;
  view: ModelFile; // current state after edits
  /** Remembered selection; the store's lmId / graphId are authoritative while the file is active. */
  nav: { lmId: number; graphId?: string };
  undo: EditRecord[]; // [] at open
  redo: EditRecord[]; // [] at open
  /** undo.length at open / last successful export (0 at open), or -1 when that state is no longer reachable. */
  savedDepth: number;
}

/** Number of unsaved edits of a file. */
export function unsavedCount(f: OpenFile): number {
  return f.savedDepth < 0 ? Math.max(1, f.undo.length) : Math.abs(f.undo.length - f.savedDepth);
}

/**
 * Records that make the file differ from its saved state: `records` (edits since the saved
 * state, or all of `undo` when the saved state is unreachable) and `reverted` (edits undone
 * past the saved state, most recently undone first).
 */
export function unsavedRecords(f: OpenFile): { records: EditRecord[]; reverted: EditRecord[] } {
  if (f.savedDepth < 0) return { records: f.undo, reverted: [] };
  if (f.undo.length >= f.savedDepth) return { records: f.undo.slice(f.savedDepth), reverted: [] };
  const n = f.savedDepth - f.undo.length;
  return { records: [], reverted: f.redo.slice(-n).reverse() };
}

/** `name`, or `name (n)` with the smallest free n >= 2 when another open file has that name. */
export function uniqueDisplayName(name: string, files: readonly OpenFile[]): string {
  if (!files.some((f) => f.file.name === name)) return name;
  const taken = new Set(files.map((f) => f.name));
  let n = 2;
  while (taken.has(`${name} (${n})`)) n++;
  return `${name} (${n})`;
}

/** First LM with >= 1 readable graph and its first graph id (graphId undefined if none). */
export function initialSelection(model: ModelFile): { lmId: number; graphId: string | undefined } {
  const lm = model.lms.find((l) => l.graphIds.length > 0);
  return lm ? { lmId: lm.lmId, graphId: lm.graphIds[0] } : { lmId: 0, graphId: undefined };
}

/** A new open-file id (crypto.randomUUID, with a fallback for non-secure contexts). */
export function newFileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `f${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}

/**
 * One input channel of a model in a diff slot (spec multi-file-edit-diff Phase 6 "Store"): the
 * comparison is between the two slots' channels, which may have different names.
 */
export interface SlotRef {
  fileId: string;
  lmId: number;
  graphId: string;
  /** Channel name within the graph (the first one with that name). */
  channel: string;
}
export type DiffMode = 'overlay' | 'side' | 'a' | 'b';
/** A node of a slot's channel. */
export interface DiffSelection {
  side: 'a' | 'b';
  index: number;
}
/** Diff view state; kept across toggling, file switches and graph selection. */
export interface DiffState {
  open: boolean;
  a?: SlotRef;
  b?: SlotRef;
  settings: DiffSettings;
  mode: DiffMode;
  /** 'any' cannot collide with a feature: feature keys are always 'feature:'-prefixed. */
  property: 'any' | DiffPropertyKey;
  hidden: NodeClass[];
  selection?: DiffSelection;
  onlyDifferences: boolean;
}

export const initialDiffState = (): DiffState => ({
  open: false,
  settings: DEFAULT_DIFF_SETTINGS,
  mode: 'overlay',
  property: 'any',
  hidden: [],
  onlyDifferences: false,
});

const sameSlot = (p: SlotRef | undefined, q: SlotRef | undefined) =>
  p === q ||
  (!!p &&
    !!q &&
    p.fileId === q.fileId &&
    p.lmId === q.lmId &&
    p.graphId === q.graphId &&
    p.channel === q.channel);

/**
 * Slot repair after `rec` was applied to file `fileId` in `direction` (Phase 6 "Slot repair");
 * `view` is that file's view after the change. Returns `diff` itself when nothing changed.
 */
export function repairSlots(
  diff: DiffState,
  fileId: string,
  rec: EditRecord,
  direction: 'forward' | 'backward',
  view: ModelFile,
): DiffState {
  const fix = (slot: SlotRef | undefined): SlotRef | undefined => {
    if (!slot || slot.fileId !== fileId) return slot;
    const m = mapAddress(rec, { lmId: slot.lmId, graphId: slot.graphId }, direction);
    if (m === null) return undefined; // removed, even if the address exists in the new view
    const next =
      m === undefined ? slot : { fileId, lmId: m.lmId, graphId: m.graphId, channel: slot.channel };
    if (!view.lms[next.lmId]?.graphs.has(next.graphId)) return undefined;
    return sameSlot(next, slot) ? slot : next;
  };
  const a = fix(diff.a);
  const b = fix(diff.b);
  if (a === diff.a && b === diff.b) return diff;
  return { ...diff, a, b, selection: undefined };
}

/** `diff` with every slot of file `fileId` cleared (closeFile). */
export function clearFileSlots(diff: DiffState, fileId: string): DiffState {
  const a = diff.a?.fileId === fileId ? undefined : diff.a;
  const b = diff.b?.fileId === fileId ? undefined : diff.b;
  if (a === diff.a && b === diff.b) return diff;
  return { ...diff, a, b, selection: undefined };
}

const DIFF_MODES: readonly DiffMode[] = ['overlay', 'side', 'a', 'b'];

export interface ViewerState {
  /** Open files in list order; `model` is the active file's view. */
  files: OpenFile[];
  activeFileId?: string;
  /** File handles by file id; outlive closeFile while another file still needs them (export). */
  sourceFiles: Map<string, SourceFile>;
  /** Always `files.find(f => f.id === activeFileId)?.view`. */
  model?: ModelFile;
  loadGen: number; // incremented whenever the displayed file changes (open / activate / close)
  loading?: { stage: 'reading' | 'parsing' | 'building'; pct?: number };
  error?: string;
  lmId: number; // index into model.lms (model.lms[lmId].lmId === lmId)
  graphId?: string; // key of model.lms[lmId].graphs
  selection?: { channel: string; index: number }; // index into that channel's nodes of the current graph
  activeTab?: string; // channel name of the active inspector tab
  /**
   * Inspector channel tabs: a node of another channel counts as "at" the selected node only
   * within this distance, as a percentage of the object bounding-sphere radius `R` (0 = exact).
   * A user preference: kept across selections, graphs and models.
   */
  matchRadiusPct: number;
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
  diff: DiffState;

  /**
   * Appends a file and activates it; also adds its `sourceFiles` entry. `id` defaults to a new
   * UUID (the load controller passes the id it stamped into the model's origins).
   */
  openFile(file: File, model: ModelFile, id?: string): void;
  activateFile(id: string): void;
  /** Closes without confirmation (the UI goes through `requestCloseFile`). */
  closeFile(id: string): void;
  /**
   * Runs `op` against the file's current view, one at a time per file (Phase 2 "Per-file edit
   * queue"); resolves false if nothing was applied. Rejects when `op` throws.
   */
  runEdit(
    fileId: string,
    op: (view: ModelFile, files: OpenFile[]) => Promise<EditRecord | undefined>,
  ): Promise<boolean>;
  /** Undo / redo on the active file at call time, queued on that file's chain. */
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  /** Resolves once every edit / undo / redo queued for the file so far has settled. */
  whenEditsIdle(fileId: string): Promise<void>;
  /**
   * After a successful export of `exportedView` (spec Phase 5): `savedDepth = undo.length`.
   * Defensive: does nothing (console.warn, returns false) when the file's view is no longer
   * `exportedView` or the file is gone.
   */
  markExported(fileId: string, exportedView: ModelFile): boolean;
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
  setMatchRadiusPct(pct: number): void;
  setOverlayChild(on: boolean): void;
  setInspectorTab(tab: InspectorTab): void;
  setChildColorMode(mode: ColorMode): void;
  setChildDisplay(patch: Partial<DisplayAsOptions>): void;
  setTheme(theme: Theme): void;
  setSystemPrefersDark(dark: boolean): void;

  // ---- diff (Phase 6) ----
  /** Flips `diff.open` only; nothing else in the diff state is reset. */
  toggleDiff(): void;
  /**
   * Fills (or clears with undefined) a slot; ignored unless `ref` is a channel of a readable
   * graph of an open file. UI code goes through `requestSlot` (slotChannel.ts), which asks for
   * the channel.
   */
  setSlot(slot: 'a' | 'b', ref: SlotRef | undefined): void;
  swapSlots(): void;
  /** Patches the settings; any change other than `preset` sets `preset: 'custom'`. */
  setDiffSettings(patch: Partial<DiffSettings>): void;
  setDiffMode(mode: DiffMode): void;
  setDiffProperty(property: 'any' | DiffPropertyKey): void;
  toggleDiffHidden(c: NodeClass): void;
  setDiffSelection(selection: DiffSelection | undefined): void;
  setDiffOnlyDifferences(on: boolean): void;
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
export const MATCH_RADIUS_MIN = 0;
export const MATCH_RADIUS_MAX = 10;
/** 2 % of R: about one node spacing in the pretrained YCB / compositional models. */
export const DEFAULT_MATCH_RADIUS_PCT = 2;

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

/** The state that shows `file` (or nothing) with the given selection; the former `setModel`. */
function showFile(
  s: ViewerState,
  file: OpenFile | undefined,
): Pick<
  ViewerState,
  | 'model'
  | 'activeFileId'
  | 'lmId'
  | 'graphId'
  | 'loadGen'
  | 'legend'
  | 'childColorMode'
  | 'childDisplay'
  | 'selection'
  | 'activeTab'
  | 'overlayChild'
  | 'colorMode'
  | 'display'
> {
  const model = file?.view;
  let lmId = 0;
  let graphId: string | undefined;
  if (file && model) {
    // Defensive: the remembered selection must still exist in the view.
    lmId = Math.max(0, Math.min(file.nav.lmId, model.lms.length - 1));
    const g = file.nav.graphId;
    graphId = g !== undefined && model.lms[lmId]?.graphs.has(g) ? g : undefined;
  }
  return {
    model,
    activeFileId: file?.id,
    lmId,
    graphId,
    loadGen: s.loadGen + 1,
    legend: emptyLegendPrefs(),
    childColorMode: { kind: 'all' },
    childDisplay: { ...DEFAULT_CHILD_DISPLAY },
    ...graphChangeResets(model, lmId, graphId, s.colorMode, s.display),
  };
}

/** `files` with the active file's nav set from the store's current selection. */
function withActiveNav(s: ViewerState): OpenFile[] {
  return s.files.map((f) =>
    f.id === s.activeFileId ? { ...f, nav: { lmId: s.lmId, graphId: s.graphId } } : f,
  );
}

// ---- edits (spec multi-file-edit-diff Phase 2 "Store additions") ----------------------------

/** One promise chain per file id; not Zustand state (not rendered, not serialisable). */
const editChains = new Map<string, Promise<unknown>>();

/** Queues `task` behind every task already queued for `fileId`; the chain survives failures. */
function enqueue<T>(fileId: string, task: () => Promise<T>): Promise<T> {
  const prev = editChains.get(fileId) ?? Promise.resolve();
  const run = prev.then(task);
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  editChains.set(fileId, tail);
  void tail.then(() => {
    if (editChains.get(fileId) === tail) editChains.delete(fileId);
  });
  return run;
}

type Selection = { lmId: number; graphId: string | undefined };

/**
 * Selection repair after one record (Phase 2 "Selection repair"). `direction` is 'forward' for
 * applyEdit / redo and 'backward' for undo; `view` is the view after the change.
 */
export function repairSelection(
  sel: Selection,
  rec: EditRecord,
  direction: 'forward' | 'backward',
  view: ModelFile,
): Selection {
  const lms = view.lms;
  const clamp = (i: number) => Math.max(0, Math.min(i, lms.length - 1));
  const mapped = mapLm(rec, sel.lmId, direction);
  const newLm = clamp(mapped === null ? sel.lmId : mapped);
  if (sel.graphId === undefined) return { lmId: newLm, graphId: undefined };
  const m = mapAddress(rec, { lmId: sel.lmId, graphId: sel.graphId }, direction);
  const cand = m === undefined ? { lmId: newLm, graphId: sel.graphId } : m;
  // Only readable graphs can be displayed (selectGraph / showFile accept readable ids only).
  if (cand && lms[cand.lmId]?.graphs.has(cand.graphId))
    return { lmId: cand.lmId, graphId: cand.graphId };
  const beforeLm = (direction === 'forward' ? rec.before : rec.after).lms[sel.lmId];
  const idx = beforeLm ? beforeLm.graphIds.indexOf(sel.graphId) : -1;
  const ids = lms[newLm]?.graphIds ?? [];
  const graphId = idx >= 0 && idx < ids.length ? ids[idx] : ids[ids.length - 1];
  return { lmId: newLm, graphId };
}

export const useViewerStore = create<ViewerState>()(
  subscribeWithSelector((set, get) => {
    /**
     * Replaces file `next.id` with `next` after `rec` was applied in `direction`: repairs the
     * selection (store lmId / graphId when active, else nav), updates `model` and prunes the
     * source-file registry. Does not increment loadGen.
     */
    function commitFile(next: OpenFile, rec: EditRecord, direction: 'forward' | 'backward') {
      set((s) => {
        const files = s.files.map((f) => (f.id === next.id ? next : f));
        const sourceFiles = pruneSourceFiles(s.sourceFiles, files);
        const diff = repairSlots(s.diff, next.id, rec, direction, next.view);
        if (next.id !== s.activeFileId) {
          const nav = repairSelection(
            { lmId: next.nav.lmId, graphId: next.nav.graphId },
            rec,
            direction,
            next.view,
          );
          const i = files.findIndex((f) => f.id === next.id);
          files[i] = { ...next, nav };
          return { files, sourceFiles, diff };
        }
        const model = next.view;
        const sel = repairSelection({ lmId: s.lmId, graphId: s.graphId }, rec, direction, model);
        const shown = getGraph(s.model, s.lmId, s.graphId);
        const now = getGraph(model, sel.lmId, sel.graphId);
        return {
          files,
          sourceFiles,
          diff,
          model,
          lmId: sel.lmId,
          graphId: sel.graphId,
          ...(now !== shown
            ? graphChangeResets(model, sel.lmId, sel.graphId, s.colorMode, s.display)
            : {}),
        };
      });
    }

    /** Internal to runEdit: pushes `rec` on the file's undo stack and shows `rec.after`. */
    function applyEdit(fileId: string, rec: EditRecord): boolean {
      const f = get().files.find((x) => x.id === fileId);
      if (!f) return false;
      if (rec.before.lms !== f.view.lms) {
        console.warn('Dropped a stale edit record', rec.kind, rec.title);
        return false;
      }
      // The saved state existed only on `redo`, which this edit clears.
      const savedDepth = f.savedDepth >= 0 && f.undo.length < f.savedDepth ? -1 : f.savedDepth;
      commitFile(
        { ...f, view: { ...f.view, ...rec.after }, undo: [...f.undo, rec], redo: [], savedDepth },
        rec,
        'forward',
      );
      return true;
    }

    return {
      files: [],
      activeFileId: undefined,
      sourceFiles: new Map(),
      model: undefined,
      loadGen: 0,
      loading: undefined,
      error: undefined,
      lmId: 0,
      graphId: undefined,
      selection: undefined,
      activeTab: undefined,
      matchRadiusPct: DEFAULT_MATCH_RADIUS_PCT,
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
      diff: initialDiffState(),

      openFile(file, model, id = newFileId()) {
        set((s) => {
          const name = uniqueDisplayName(file.name, s.files);
          const open: OpenFile = {
            id,
            file,
            name,
            byteLength: model.byteLength,
            view: model,
            nav: initialSelection(model),
            undo: [],
            redo: [],
            savedDepth: 0,
          };
          const files = [...withActiveNav(s), open];
          const sourceFiles = new Map(s.sourceFiles);
          sourceFiles.set(id, { file, name });
          return {
            files,
            sourceFiles,
            loading: undefined,
            error: undefined,
            ...showFile(s, open),
          };
        });
      },

      activateFile(id) {
        set((s) => {
          if (id === s.activeFileId) return s;
          const files = withActiveNav(s);
          const target = files.find((f) => f.id === id);
          if (!target) return s;
          return { files, ...showFile(s, target) };
        });
      },

      closeFile(id) {
        set((s) => {
          const i = s.files.findIndex((f) => f.id === id);
          if (i < 0) return s;
          const saved = withActiveNav(s);
          const files = saved.filter((f) => f.id !== id);
          const sourceFiles = pruneSourceFiles(s.sourceFiles, files);
          const diff = clearFileSlots(s.diff, id);
          if (id !== s.activeFileId) return { files, sourceFiles, diff };
          // Activate the next row, else the previous one, else show nothing.
          const next = files[i] ?? files[i - 1];
          return { files, sourceFiles, diff, ...showFile(s, next) };
        });
      },

      runEdit(fileId, op) {
        return enqueue(fileId, async () => {
          const f = get().files.find((x) => x.id === fileId);
          if (!f) return false;
          const rec = await op(f.view, get().files);
          if (rec === undefined) return false;
          if (!get().files.some((x) => x.id === fileId)) return false; // closed while op ran
          return applyEdit(fileId, rec);
        });
      },

      undo() {
        const fileId = get().activeFileId;
        if (fileId === undefined) return Promise.resolve(false);
        return enqueue(fileId, async () => {
          const f = get().files.find((x) => x.id === fileId);
          const rec = f?.undo[f.undo.length - 1];
          if (!f || !rec) return false;
          commitFile(
            {
              ...f,
              view: { ...f.view, ...rec.before },
              undo: f.undo.slice(0, -1),
              redo: [...f.redo, rec],
            },
            rec,
            'backward',
          );
          return true;
        });
      },

      redo() {
        const fileId = get().activeFileId;
        if (fileId === undefined) return Promise.resolve(false);
        return enqueue(fileId, async () => {
          const f = get().files.find((x) => x.id === fileId);
          const rec = f?.redo[f.redo.length - 1];
          if (!f || !rec) return false;
          commitFile(
            {
              ...f,
              view: { ...f.view, ...rec.after },
              undo: [...f.undo, rec],
              redo: f.redo.slice(0, -1),
            },
            rec,
            'forward',
          );
          return true;
        });
      },

      whenEditsIdle(fileId) {
        return editChains.get(fileId)?.then(() => undefined) ?? Promise.resolve();
      },

      markExported(fileId, exportedView) {
        const f = get().files.find((x) => x.id === fileId);
        if (!f) return false;
        if (f.view !== exportedView) {
          console.warn('Export finished but the file changed meanwhile; edits stay unsaved');
          return false;
        }
        const next: OpenFile = { ...f, savedDepth: f.undo.length };
        set((s) => ({ files: s.files.map((x) => (x.id === fileId ? next : x)) }));
        return true;
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

      setMatchRadiusPct(pct) {
        set((s) => ({
          matchRadiusPct: clampNum(pct, MATCH_RADIUS_MIN, MATCH_RADIUS_MAX, s.matchRadiusPct),
        }));
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

      toggleDiff() {
        set((s) => ({ diff: { ...s.diff, open: !s.diff.open } }));
      },

      setSlot(slot, ref) {
        if (slot !== 'a' && slot !== 'b') return;
        set((s) => {
          let next: SlotRef | undefined;
          if (ref) {
            const f = s.files.find((x) => x.id === ref.fileId);
            // Unreadable graphs (not in `graphs`) cannot be put in a slot.
            const g = f?.view.lms[ref.lmId]?.graphs.get(ref.graphId);
            if (!g?.channels.some((c) => c.channel === ref.channel)) return s;
            next = {
              fileId: ref.fileId,
              lmId: ref.lmId,
              graphId: ref.graphId,
              channel: ref.channel,
            };
          }
          if (sameSlot(next, s.diff[slot])) return s;
          return { diff: { ...s.diff, [slot]: next, selection: undefined } };
        });
      },

      swapSlots() {
        set((s) =>
          s.diff.a === undefined && s.diff.b === undefined
            ? s
            : { diff: { ...s.diff, a: s.diff.b, b: s.diff.a, selection: undefined } },
        );
      },

      setDiffSettings(patch) {
        set((s) => {
          const settings = patchDiffSettings(s.diff.settings, patch);
          if (settings === s.diff.settings) return s;
          return { diff: { ...s.diff, settings, selection: undefined } };
        });
      },

      setDiffMode(mode) {
        if (!DIFF_MODES.includes(mode)) return;
        set((s) => (s.diff.mode === mode ? s : { diff: { ...s.diff, mode } }));
      },

      setDiffProperty(property) {
        if (property !== 'any' && property !== 'position' && !property.startsWith('feature:'))
          return;
        set((s) => (s.diff.property === property ? s : { diff: { ...s.diff, property } }));
      },

      toggleDiffHidden(c) {
        if (c !== 0 && c !== 1 && c !== 2 && c !== 3) return;
        set((s) => {
          const prev = s.diff.hidden;
          const hidden = prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c];
          return { diff: { ...s.diff, hidden } };
        });
      },

      setDiffSelection(selection) {
        set((s) => ({
          diff: {
            ...s.diff,
            selection: selection ? { side: selection.side, index: selection.index } : undefined,
          },
        }));
      },

      setDiffOnlyDifferences(on) {
        set((s) => ({ diff: { ...s.diff, onlyDifferences: !!on } }));
      },
    };
  }),
);
