/**
 * Local UI state of the diff view (spec multi-file-edit-diff Phase 7b): whether the settings
 * dialog is open. Opened from the tools row's gear button and the summary footer's
 * "Settings…"; not part of `DiffState` (nothing about it needs to survive toggling the view).
 */
import { create } from 'zustand';

export const useDiffUi = create<{ settingsOpen: boolean }>(() => ({ settingsOpen: false }));

export const openDiffSettings = () => useDiffUi.setState({ settingsOpen: true });
export const closeDiffSettings = () => useDiffUi.setState({ settingsOpen: false });
