/**
 * The diff view (spec multi-file-edit-diff Phase 7a "Layout"): replaces the viewport and the
 * inspector while `diff.open`; the sidebar stays. Panes (each headed by its slot) on the left, the summary
 * panel (360 px, like the inspector) on the right; below 1100 px the panel is a bottom sheet
 * like the inspector's (Phase 7b "Narrow layout"). The settings dialog (Phase 7b) is mounted
 * here while open.
 */
import { useEffect } from 'react';
import { useDiff } from '../../diff/useDiff';
import { closeDiffSettings, useDiffUi } from './diffUi';
import { DiffSettingsDialog } from './DiffSettingsDialog';
import { DiffSummary } from './DiffSummary';
import { DiffViewport } from './DiffViewport';

export function DiffView() {
  const status = useDiff();
  const settingsOpen = useDiffUi((s) => s.settingsOpen);
  // The settings dialog belongs to the view: closing the view drops an open draft.
  useEffect(() => closeDiffSettings, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 max-[1100px]:flex-col">
      <main
        aria-label="Diff view"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-viewport p-4 select-none max-[1100px]:overflow-y-auto"
      >
        <DiffViewport status={status} />
      </main>
      <div className="flex min-h-0 w-[360px] shrink-0 flex-col border-l border-border bg-panel max-[1100px]:h-[45%] max-[1100px]:w-full max-[1100px]:border-t max-[1100px]:border-l-0">
        <DiffSummary status={status} />
      </div>
      {settingsOpen && <DiffSettingsDialog />}
    </div>
  );
}
