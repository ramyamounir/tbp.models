/**
 * UI state and entry points of the Phase 3a row editing UI (spec multi-file-edit-diff Phase 3a):
 * the graph list's multi-selection, the inline rename target and the pending delete request,
 * plus the edit actions every entry point (row menu, bulk bar, keyboard, top bar) calls.
 *
 * Every edit goes through `runEdit` / `undo()` / `redo()` (Phase 2 per-file queue) with the
 * failure toast; nothing here calls `applyEdit` or passes a view read earlier.
 *
 * The multi-selection lives here rather than in GraphList's component state so the global
 * keyboard handler (`Delete`, `Ctrl D`) can act on it. It is scoped to one file and LM: a
 * selection whose `scope` differs from the list being shown counts as empty, so it resets when
 * the file or LM changes, like component-local state would.
 */
import { create } from 'zustand';
import { showToast } from '../components/ui/Toast';
import {
  addLm,
  deleteGraphs,
  deleteLm,
  duplicateGraphs,
  duplicateLm,
  renameGraph,
} from '../edit/ops';
import type { GraphOrigin, LmEntry } from '../model/types';
import { useViewerStore } from './store';

export interface MultiSelection {
  /** `listScope(fileId, lmId)` of the list the keys belong to. */
  scope: string;
  /** Row keys (`readableRowKey` / `unreadableRowKey`) in the order they were selected. */
  keys: string[];
  /** Row key of the last plain / Ctrl click, the start of a Shift range. */
  anchor?: string;
}

export interface RenameTarget {
  fileId: string;
  lmId: number;
  graphId: string;
}

export interface DeleteRequest {
  fileId: string;
  lmId: number;
  graphIds: string[];
  unreadable: GraphOrigin[];
}

/** Delete-LM confirmation request (Phase 3b). */
export interface LmDeleteRequest {
  fileId: string;
  lmId: number;
}

interface EditUiState {
  multi: MultiSelection;
  renaming?: RenameTarget;
  deleteRequest?: DeleteRequest;
  lmDeleteRequest?: LmDeleteRequest;
}

export const useEditUi = create<EditUiState>(() => ({
  multi: { scope: '', keys: [] },
  renaming: undefined,
  deleteRequest: undefined,
  lmDeleteRequest: undefined,
}));

export const listScope = (fileId: string | undefined, lmId: number) =>
  `${fileId ?? ''}\u0000${lmId}`;
/** Row key of a readable graph (prefixed so it never collides with an unreadable key). */
export const readableRowKey = (graphId: string) => `r:${graphId}`;
/** Row key of an unreadable entry: by on-disk origin, its label need not be unique. */
export const unreadableRowKey = (o: GraphOrigin) => `u:${o.lmId}:${o.entry}`;

/** The multi-selection keys of the list `scope`, or [] when the selection belongs elsewhere. */
export function multiKeysFor(multi: MultiSelection, scope: string): string[] {
  return multi.scope === scope ? multi.keys : [];
}

export function setMulti(scope: string, keys: string[], anchor?: string): void {
  useEditUi.setState({ multi: { scope, keys, anchor } });
}

export function clearMulti(): void {
  const { multi } = useEditUi.getState();
  if (multi.keys.length === 0 && multi.anchor === undefined) return;
  useEditUi.setState({ multi: { scope: multi.scope, keys: [] } });
}

/** Splits row keys into the readable ids and unreadable origins that still exist in `lm`. */
export function resolveRowKeys(
  lm: LmEntry,
  keys: readonly string[],
): { graphIds: string[]; unreadable: GraphOrigin[] } {
  const graphIds: string[] = [];
  const unreadable: GraphOrigin[] = [];
  for (const k of keys) {
    if (k.startsWith('r:')) {
      const id = k.slice(2);
      if (lm.graphs.has(id)) graphIds.push(id);
    } else {
      const u = lm.unreadable.find((x) => unreadableRowKey(x.origin) === k);
      if (u) unreadable.push(u.origin);
    }
  }
  return { graphIds, unreadable };
}

// ---- edit actions ---------------------------------------------------------------------------

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The failure toast every edit call site attaches (Phase 2 `runEdit` rejects when an op throws). */
export function editFailed(err: unknown): void {
  console.error(err);
  showToast({ text: `Edit failed: ${errorText(err)}` });
}

export function duplicateGraphsAction(fileId: string, lmId: number, graphIds: string[]): void {
  if (graphIds.length === 0) return;
  useViewerStore
    .getState()
    .runEdit(fileId, (view) => duplicateGraphs(view, lmId, graphIds))
    .catch(editFailed);
}

/** Opens the delete confirmation (always shown, even for unreferenced models). */
export function requestDeleteGraphs(
  fileId: string,
  lmId: number,
  graphIds: string[],
  unreadable: GraphOrigin[] = [],
): void {
  if (graphIds.length === 0 && unreadable.length === 0) return;
  useEditUi.setState({ deleteRequest: { fileId, lmId, graphIds, unreadable } });
}

export function cancelDelete(): void {
  useEditUi.setState({ deleteRequest: undefined });
}

/** Dialog confirm: closes without waiting and queues the delete on the file's chain. */
export function confirmDelete(): void {
  const req = useEditUi.getState().deleteRequest;
  if (!req) return;
  useEditUi.setState({ deleteRequest: undefined });
  const { multi } = useEditUi.getState();
  if (multi.scope === listScope(req.fileId, req.lmId)) clearMulti();
  useViewerStore
    .getState()
    .runEdit(req.fileId, (view) => deleteGraphs(view, req.lmId, req.graphIds, req.unreadable))
    .catch(editFailed);
}

export function startRename(fileId: string, lmId: number, graphId: string): void {
  useEditUi.setState({ renaming: { fileId, lmId, graphId } });
}

export function cancelRename(): void {
  if (useEditUi.getState().renaming) useEditUi.setState({ renaming: undefined });
}

/** Closes the field and queues the rename; the row shows the new name once it lands. */
export function commitRename(
  fileId: string,
  lmId: number,
  from: string,
  to: string,
  rewriteReferences: boolean,
): void {
  useEditUi.setState({ renaming: undefined });
  if (to === from) return;
  // Keep a multi-selected row selected under its new name.
  const { multi } = useEditUi.getState();
  const scope = listScope(fileId, lmId);
  useViewerStore
    .getState()
    .runEdit(fileId, (view) => renameGraph(view, lmId, from, to, { rewriteReferences }))
    .then((applied) => {
      if (!applied) {
        showToast({ text: `Rename not applied: "${from}" changed by an earlier edit` });
        return;
      }
      const cur = useEditUi.getState().multi;
      if (cur.scope !== scope || cur !== multi) return;
      const fromKey = readableRowKey(from);
      if (!cur.keys.includes(fromKey)) return;
      setMulti(
        scope,
        cur.keys.map((k) => (k === fromKey ? readableRowKey(to) : k)),
        cur.anchor === fromKey ? readableRowKey(to) : cur.anchor,
      );
    })
    .catch(editFailed);
}

// ---- LM actions (Phase 3b) -------------------------------------------------------------------

/** "+" button: appends an empty LM to the file. */
export function addLmAction(fileId: string): void {
  useViewerStore
    .getState()
    .runEdit(fileId, (view) => addLm(view))
    .catch(editFailed);
}

export function duplicateLmAction(fileId: string, lmId: number): void {
  useViewerStore
    .getState()
    .runEdit(fileId, (view) => duplicateLm(view, lmId))
    .catch(editFailed);
}

/** Opens the delete-LM confirmation (it lists what the renumbering affects). */
export function requestDeleteLm(fileId: string, lmId: number): void {
  useEditUi.setState({ lmDeleteRequest: { fileId, lmId } });
}

export function cancelDeleteLm(): void {
  useEditUi.setState({ lmDeleteRequest: undefined });
}

/** Dialog confirm: closes without waiting and queues the LM delete on the file's chain. */
export function confirmDeleteLm(): void {
  const req = useEditUi.getState().lmDeleteRequest;
  if (!req) return;
  useEditUi.setState({ lmDeleteRequest: undefined });
  useViewerStore
    .getState()
    .runEdit(req.fileId, (view) => deleteLm(view, req.lmId))
    .catch(editFailed);
}

export function undoAction(): void {
  useViewerStore.getState().undo().catch(editFailed);
}

export function redoAction(): void {
  useViewerStore.getState().redo().catch(editFailed);
}

/**
 * What keyboard actions act on in the active file and LM: the multi-selection when it is
 * non-empty, else the displayed graph.
 */
export function keyboardTargets():
  { fileId: string; lmId: number; graphIds: string[]; unreadable: GraphOrigin[] } | undefined {
  const s = useViewerStore.getState();
  const fileId = s.activeFileId;
  const lm = s.model?.lms[s.lmId];
  if (fileId === undefined || !lm) return undefined;
  const keys = multiKeysFor(useEditUi.getState().multi, listScope(fileId, s.lmId));
  if (keys.length > 0) return { fileId, lmId: s.lmId, ...resolveRowKeys(lm, keys) };
  if (s.graphId === undefined || !lm.graphs.has(s.graphId)) return undefined;
  return { fileId, lmId: s.lmId, graphIds: [s.graphId], unreadable: [] };
}
