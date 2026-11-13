import { useEffect, useRef, useState } from 'react';
import { DiffView } from './components/Diff/DiffView';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Inspector } from './components/Inspector/Inspector';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar';
import { CloseFileDialog } from './components/Sidebar/CloseFileDialog';
import { CopyChildrenPromptHost } from './components/Sidebar/CopyToMenu';
import { DeleteGraphsDialog } from './components/Sidebar/DeleteGraphsDialog';
import { DeleteLmDialog } from './components/Sidebar/DeleteLmDialog';
import { ExportDialog } from './components/Export/ExportDialog';
import { ToastHost } from './components/ui/Toast';
import { Viewport } from './components/Viewport/Viewport';
import { openModelFile } from './loader/loadController';
import { installHistory } from './state/history';
import { installKeyboard } from './state/keyboard';
import { unsavedCount, useViewerStore } from './state/store';

/** Below this width the sidebar starts collapsed (it can always be toggled from the top bar). */
const SIDEBAR_AUTO_COLLAPSE_PX = 800;

function initialSidebarOpen(): boolean {
  return typeof window === 'undefined' || window.innerWidth >= SIDEBAR_AUTO_COLLAPSE_PX;
}

export default function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  // App-local UI state (not persisted; the theme is the only persisted setting).
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  // Export dialog of the active file: the top-bar button sets it; ExportDialog is rendered while
  // it is true and resets it on close.
  const [exportOpen, setExportOpen] = useState(false);
  const activeFileId = useViewerStore((s) => s.activeFileId);
  const graphKey = useViewerStore((s) => `${s.loadGen}:${s.lmId}:${s.graphId ?? ''}`);
  const diffOpen = useViewerStore((s) => s.diff.open);
  useEffect(() => installKeyboard(), []);
  useEffect(() => installHistory(), []);
  useEffect(() => {
    // Leave / reload confirmation while any open file has unsaved edits.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (useViewerStore.getState().files.some((f) => unsavedCount(f) > 0)) e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
  const openPicker = () => fileInput.current?.click();
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-text">
      {/* The one file picker: top bar "Open model…" and the "+ Open another model.pt" row. */}
      <input
        ref={fileInput}
        type="file"
        accept=".pt"
        multiple
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const t0 = performance.now();
          const files = Array.from(e.currentTarget.files ?? []);
          e.currentTarget.value = ''; // picking the same file again still fires change
          for (const file of files) openModelFile(file, t0);
        }}
      />
      <TopBar
        onOpenModel={openPicker}
        onExport={() => setExportOpen(true)}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      <DisclaimerBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} onOpenModel={openPicker} />
        {/* Viewport + inspector: side by side, or inspector as a bottom sheet under 1100 px. */}
        <div className={diffOpen ? 'hidden' : 'flex min-h-0 min-w-0 flex-1 max-[1100px]:flex-col'}>
          {/* The viewport stays mounted (paused) while the diff view is open, so its scene and
              camera survive toggling; the inspector is replaced by the diff panel. */}
          <ErrorBoundary name="Viewport" resetKey={graphKey} className="min-h-0 min-w-0 flex-1">
            <Viewport />
          </ErrorBoundary>
          {!diffOpen && (
            <ErrorBoundary
              name="Inspector"
              resetKey={graphKey}
              className="w-[360px] shrink-0 border-l border-border max-[1100px]:h-[45%] max-[1100px]:w-full max-[1100px]:border-t max-[1100px]:border-l-0"
            >
              <Inspector />
            </ErrorBoundary>
          )}
        </div>
        {diffOpen && (
          <ErrorBoundary name="Diff view" resetKey="diff" className="min-h-0 min-w-0 flex-1">
            <DiffView />
          </ErrorBoundary>
        )}
      </div>
      <CloseFileDialog />
      <DeleteGraphsDialog />
      <DeleteLmDialog />
      {exportOpen && activeFileId !== undefined && (
        <ExportDialog
          key={activeFileId}
          fileId={activeFileId}
          onClose={() => setExportOpen(false)}
        />
      )}
      <CopyChildrenPromptHost />
      <ToastHost />
    </div>
  );
}
