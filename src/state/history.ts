/**
 * Browser-history sync for hierarchy navigation (spec Phase 5 "History entries").
 *
 * `history.state` only ever holds `{ lmId, graphId, loadGen }` — never node data or the model.
 * "Open in LM k →" first `replaceState`s the current graph (so Back has a valid entry), then
 * `pushState`s the target and calls `selectGraph`. On `popstate` an entry is accepted only if it
 * still names a graph of the currently loaded model (`loadGen` must match), otherwise ignored.
 */
import type { ModelFile } from '../model/types';
import { useViewerStore } from './store';

export interface HistoryEntry {
  lmId: number;
  graphId: string;
  loadGen: number;
}

/** Validates a `history.state` value against the current model; pure, for tests. */
export function validHistoryEntry(
  state: unknown,
  model: ModelFile | undefined,
  loadGen: number,
): HistoryEntry | undefined {
  if (!model || typeof state !== 'object' || state === null) return undefined;
  const { lmId, graphId, loadGen: gen } = state as Record<string, unknown>;
  if (!Number.isInteger(lmId) || typeof graphId !== 'string' || gen !== loadGen) return undefined;
  const lm = lmId as number;
  if (lm < 0 || lm >= model.lms.length) return undefined;
  if (!model.lms[lm].graphs.has(graphId)) return undefined;
  return { lmId: lm, graphId, loadGen };
}

/** Navigate to a child graph in another LM, recording a history entry so Back returns here. */
export function navigateToGraph(lmId: number, graphId: string): void {
  const s = useViewerStore.getState();
  if (!s.model || !s.model.lms[lmId]?.graphs.has(graphId)) return;
  if (lmId === s.lmId && graphId === s.graphId) return;
  try {
    if (s.graphId !== undefined) {
      history.replaceState(
        { lmId: s.lmId, graphId: s.graphId, loadGen: s.loadGen } satisfies HistoryEntry,
        '',
      );
    }
    history.pushState({ lmId, graphId, loadGen: s.loadGen } satisfies HistoryEntry, '');
  } catch (err) {
    // History API unavailable (e.g. sandboxed iframe); navigation still works without Back.
    console.warn('Could not record navigation history', err);
  }
  s.selectGraph(lmId, graphId);
}

export function onPopState(e: PopStateEvent): void {
  const s = useViewerStore.getState();
  const entry = validHistoryEntry(e.state, s.model, s.loadGen);
  if (entry) s.selectGraph(entry.lmId, entry.graphId);
}

/** Installs the `popstate` listener; called once from `App.tsx`. Returns the cleanup. */
export function installHistory(): () => void {
  window.addEventListener('popstate', onPopState);
  return () => window.removeEventListener('popstate', onPopState);
}
