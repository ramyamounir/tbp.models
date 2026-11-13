/**
 * Local UI state of the diff view (spec multi-file-edit-diff Phase 7b): whether the settings
 * dialog is open. Opened from the tools row's gear button and the summary footer's
 * "Settings…"; not part of `DiffState` (nothing about it needs to survive toggling the view).
 */
import { create } from 'zustand';

/** Below this window width or height the summary sheet starts collapsed (phones). */
const SHEET_COLLAPSE_W = 640;
const SHEET_COLLAPSE_H = 520;

function initialSheetOpen(): boolean {
  if (typeof window === 'undefined') return true;
  return window.innerWidth > SHEET_COLLAPSE_W && window.innerHeight > SHEET_COLLAPSE_H;
}

export const useDiffUi = create<{
  settingsOpen: boolean;
  /** Narrow layout only: whether the summary bottom sheet is expanded. */
  sheetOpen: boolean;
  /** The user's choice for the pane legends; undefined: expanded unless the pane is short. */
  legendOpen: boolean | undefined;
}>(() => ({ settingsOpen: false, sheetOpen: initialSheetOpen(), legendOpen: undefined }));

export const toggleDiffSheet = () => useDiffUi.setState((s) => ({ sheetOpen: !s.sheetOpen }));
export const setDiffLegendOpen = (open: boolean) => useDiffUi.setState({ legendOpen: open });

export const openDiffSettings = () => useDiffUi.setState({ settingsOpen: true });
export const closeDiffSettings = () => useDiffUi.setState({ settingsOpen: false });
