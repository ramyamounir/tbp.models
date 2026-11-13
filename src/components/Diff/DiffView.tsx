/**
 * The diff view (spec multi-file-edit-diff Phase 7a "Layout"): replaces the viewport and the
 * inspector while `diff.open`; the sidebar stays. Panes (each headed by its slot) on the left, the summary
 * panel (360 px, like the inspector) on the right; below 1100 px the panel is a bottom sheet
 * like the inspector's (Phase 7b "Narrow layout"). The settings dialog (Phase 7b) is mounted
 * here while open.
 */
import { useEffect } from 'react';
import { useDiff } from '../../diff/useDiff';
import { closeDiffSettings, toggleDiffSheet, useDiffUi } from './diffUi';
import { DiffSettingsDialog } from './DiffSettingsDialog';
import { DiffSummary } from './DiffSummary';
import { DiffViewport } from './DiffViewport';

export function DiffView() {
  const status = useDiff();
  const settingsOpen = useDiffUi((s) => s.settingsOpen);
  const sheetOpen = useDiffUi((s) => s.sheetOpen);
  // The settings dialog belongs to the view: closing the view drops an open draft.
  useEffect(() => closeDiffSettings, []);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 max-[1100px]:flex-col">
      <main
        aria-label="Diff view"
        className="relative flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-hidden bg-viewport p-4 select-none max-[640px]:gap-2 max-[640px]:p-2"
      >
        <DiffViewport status={status} />
      </main>
      <div
        className={`flex min-h-0 w-[360px] shrink-0 flex-col border-l border-border bg-panel max-[1100px]:w-full max-[1100px]:border-t max-[1100px]:border-l-0 ${
          sheetOpen ? 'max-[1100px]:h-[45%]' : ''
        }`}
      >
        {/* Narrow layout: the summary is a bottom sheet; this handle collapses it to one row so
            the panes get the height. */}
        <button
          type="button"
          onClick={toggleDiffSheet}
          aria-expanded={sheetOpen}
          aria-controls="diff-summary-sheet"
          className="hidden h-9 shrink-0 items-center justify-between border-b border-border px-4 text-[11px] font-semibold tracking-wide text-muted uppercase hover:bg-row-alt max-[1100px]:flex"
        >
          <span>Summary</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={sheetOpen ? '' : 'rotate-180'}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <div
          id="diff-summary-sheet"
          className={`min-h-0 flex-1 flex-col ${sheetOpen ? 'flex' : 'flex max-[1100px]:hidden'}`}
        >
          <DiffSummary status={status} />
        </div>
      </div>
      {settingsOpen && <DiffSettingsDialog />}
    </div>
  );
}
