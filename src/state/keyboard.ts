/**
 * The single global keyboard handler (spec Phase 3 "Keyboard"). Phase 4 extends this same switch
 * (`[` / `]`, `←` / `→`); no other `keydown` listener exists anywhere.
 */
import { getGraph, useViewerStore, type ViewerState } from './store';
import { getViewer } from '../viewer/sceneRegistry';
import { activeNode, findChannel, tabOrder } from '../components/Inspector/activeNode';

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName);
}

export function onKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  if (isTypingTarget(e.target)) return;
  const s = useViewerStore.getState();
  switch (e.key) {
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

/** `[` / `]`: cycle the inspector channel tabs (wraps). Returns false when there is no selection. */
export function cycleTab(s: ViewerState, dir: -1 | 1): boolean {
  const sel = s.selection;
  if (!sel) return false;
  const tabs = tabOrder(getGraph(s.model, s.lmId, s.graphId));
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
  const active = activeNode(graph, sel, s.activeTab);
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
