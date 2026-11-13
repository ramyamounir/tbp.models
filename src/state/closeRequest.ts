/**
 * Close-file guard (spec multi-file-edit-diff Phase 1 "Guards"). UI code closes a file only
 * through `requestCloseFile`, which asks first (CloseFileDialog) when the file has unsaved edits.
 */
import { create } from 'zustand';
import { unsavedCount, useViewerStore } from './store';

/** The file whose close waits for confirmation (UI-only state, not part of the viewer store). */
export const useCloseRequest = create<{ fileId?: string }>(() => ({ fileId: undefined }));

export function requestCloseFile(id: string): void {
  const f = useViewerStore.getState().files.find((x) => x.id === id);
  if (!f) return;
  if (unsavedCount(f) > 0) useCloseRequest.setState({ fileId: id });
  else useViewerStore.getState().closeFile(id);
}
