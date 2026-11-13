/**
 * The single global keyboard handler (spec Phase 3 "Keyboard"). Phase 4 extends this same switch
 * (`[` / `]`, `←` / `→`); multi-file-edit-diff Phase 3a adds the edit shortcuts (`F2`, `Delete`,
 * `Ctrl D`, undo / redo). No other global `keydown` listener exists anywhere.
 */
import { getGraph, useViewerStore, type ViewerState } from './store';
import { getViewer } from '../viewer/sceneRegistry';
import { getDiffScenes } from '../viewer/diffSceneRegistry';
import { currentDiffResult } from '../diff/useDiff';
import { differenceList, stepDifference } from '../diff/viewClasses';
import {
  duplicateGraphsAction,
  keyboardTargets,
  redoAction,
  requestDeleteGraphs,
  startRename,
  undoAction,
} from './editUi';
import {
  activeNode,
  findChannel,
  matchRadiusM,
  tabOrder,
} from '../components/Inspector/activeNode';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

/**
 * Edit shortcuts (spec multi-file-edit-diff Phase 3a "Keyboard"), the only modifier combinations
 * this handler accepts: `Ctrl`/`Cmd`+`D` duplicate, `Ctrl`/`Cmd`+`Z` undo, `Ctrl`/`Cmd`+`Shift`+`Z`
 * and `Ctrl`+`Y` redo. Returns false for any other combination.
 */
function onModifiedKey(e: KeyboardEvent): boolean {
  const key = e.key.toLowerCase();
  if (key === 'd' && !e.shiftKey) {
    const s = useViewerStore.getState();
    if (s.activeFileId === undefined) return false;
    const t = keyboardTargets();
    if (t) duplicateGraphsAction(t.fileId, t.lmId, t.graphIds);
    return true; // also keeps the browser's bookmark dialog closed
  }
  if (key === 'z') {
    if (e.shiftKey) redoAction();
    else undoAction();
    return true;
  }
  if (key === 'y' && e.ctrlKey && !e.metaKey && !e.shiftKey) {
    redoAction();
    return true;
  }
  return false;
}

export function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  // A modal dialog owns the keyboard while it is open (no edit, undo or redo can run then).
  if (typeof document !== 'undefined' && document.querySelector('[aria-modal="true"]')) return;
  if (e.ctrlKey || e.metaKey) {
    if (onModifiedKey(e)) e.preventDefault();
    return;
  }
  const s = useViewerStore.getState();
  if (s.diff.open) {
    // The diff view replaces the viewport and inspector: their shortcuts are inactive.
    if (onDiffKey(s, e.key)) e.preventDefault();
    if (e.key !== 'F2' && e.key !== 'Delete' && e.key !== 'Backspace') return;
  }
  switch (e.key) {
    case 'F2': {
      const t = keyboardTargets();
      // Rename needs exactly one readable model.
      if (!t || t.graphIds.length !== 1 || t.unreadable.length > 0) return;
      startRename(t.fileId, t.lmId, t.graphIds[0]);
      break;
    }
    case 'Delete':
    case 'Backspace': {
      const t = keyboardTargets();
      if (!t || t.graphIds.length + t.unreadable.length === 0) return;
      requestDeleteGraphs(t.fileId, t.lmId, t.graphIds, t.unreadable);
      break;
    }
    case 'r':
    case 'R':
      s.setTool(s.tool === 'rotate' ? 'orbit' : 'rotate');
      break;
    case 'Escape':
      s.setSelection(undefined); // also clears activeTab / overlayChild per setSelection
      break;
    case 'f':
    case 'F':
      getViewer()?.fit(); // no-op while no viewer is registered
      break;
    case '[':
    case ']':
      if (!cycleTab(s, e.key === '[' ? -1 : 1)) return;
      break;
    case 'ArrowLeft':
    case 'ArrowRight':
      if (!stepNode(s, e.key === 'ArrowLeft' ? -1 : 1)) return;
      break;
    default:
      return;
  }
  e.preventDefault();
}

/**
 * Diff view keys (spec multi-file-edit-diff Phase 7b "Keyboard"): `Esc` clears the node
 * selection (an open settings dialog is modal and handles its own `Esc`), `←` / `→` step to the
 * previous / next difference, `F` fits the diff panes. Returns true when the key was handled.
 */
function onDiffKey(s: ViewerState, key: string): boolean {
  switch (key) {
    case 'Escape':
      if (!s.diff.selection) return false;
      s.setDiffSelection(undefined);
      return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const result = currentDiffResult();
      if (!result) return false;
      const next = stepDifference(
        result,
        differenceList(result),
        s.diff.selection,
        key === 'ArrowLeft' ? -1 : 1,
      );
      if (!next) return false;
      s.setDiffSelection(next);
      return true;
    }
    case 'f':
    case 'F': {
      const scenes = getDiffScenes();
      scenes.forEach((sc) => sc.fit());
      return scenes.length > 0;
    }
    default:
      return false;
  }
}

/**
 * `[` / `]`: cycle the inspector channel tabs that have a node at the selection (within the match
 * radius; wraps). Returns false when there is no selection.
 */
export function cycleTab(s: ViewerState, dir: -1 | 1): boolean {
  const sel = s.selection;
  if (!sel) return false;
  const graph = getGraph(s.model, s.lmId, s.graphId);
  const tabs = tabOrder(graph, sel, matchRadiusM(graph, s.matchRadiusPct));
  const n = tabs.length;
  if (n === 0) return false;
  const i = Math.max(0, tabs.indexOf(s.activeTab ?? sel.channel));
  s.setActiveTab(tabs[(i + dir + n) % n]);
  return true;
}

/**
 * `←` / `→` (and the inspector header prev/next buttons): select the previous/next node of the
 * active node's channel, clamped to the channel (no wrap; a no-op at either end). The child
 * overlay stays on if it was on. Returns false when there is no selection or active node.
 */
export function stepNode(s: ViewerState, dir: -1 | 1): boolean {
  const sel = s.selection;
  if (!sel) return false;
  const graph = getGraph(s.model, s.lmId, s.graphId);
  const active = activeNode(graph, sel, s.activeTab, matchRadiusM(graph, s.matchRadiusPct));
  const ch = active && findChannel(graph, active.channel);
  if (!active || !ch) return false;
  const next = Math.min(ch.n - 1, Math.max(0, active.index + dir));
  if (next !== active.index)
    s.setSelection({ channel: active.channel, index: next }, { keepOverlay: true });
  return true;
}

export function installKeyboard(): () => void {
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}
