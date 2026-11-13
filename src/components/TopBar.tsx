import { useState } from 'react';
import { redoAction, undoAction } from '../state/editUi';
import { unsavedCount, useViewerStore, type Theme } from '../state/store';
import { getViewer, useViewer } from '../viewer/sceneRegistry';
import { downloadBlob } from '../util/download';
import { screenshotFileName } from '../viewer/screenshot';
import { Breadcrumb } from './Breadcrumb';

const LOGO_SRC = `${import.meta.env.BASE_URL}logo.png`;

const NEXT_THEME: Record<Theme, Theme> = {
  light: 'dark',
  dark: 'system',
  system: 'light',
};
const THEME_LABEL: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (theme === 'light') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
      </svg>
    );
  }
  if (theme === 'dark') {
    return (
      <svg {...common}>
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="18" height="12" rx="2" />
      <path d="M8 20h8M12 16v4" />
    </svg>
  );
}

function ThemeToggle() {
  const theme = useViewerStore((s) => s.theme);
  const setTheme = useViewerStore((s) => s.setTheme);
  const next = NEXT_THEME[theme];
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-panel px-2.5 text-[13px] text-text hover:bg-row-alt"
      title={`Theme: ${THEME_LABEL[theme]} (click for ${THEME_LABEL[next]})`}
      aria-label={`Theme: ${THEME_LABEL[theme]}. Switch to ${THEME_LABEL[next]}`}
    >
      <ThemeIcon theme={theme} />
      <span className="max-[1100px]:hidden">{THEME_LABEL[theme]}</span>
    </button>
  );
}

/** Saves the main viewport canvas as PNG (no gizmo, legend or HTML overlays). */
function ScreenshotButton() {
  const viewer = useViewer();
  const diffOpen = useViewerStore((s) => s.diff.open);
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    const v = getViewer();
    if (!v || busy) return;
    setBusy(true);
    try {
      const { lmId, graphId } = useViewerStore.getState();
      downloadBlob(await v.screenshot(), screenshotFileName(lmId, graphId));
    } catch (e) {
      console.error('Screenshot failed', e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!viewer || busy || diffOpen}
      title={diffOpen ? 'Close the diff view to save a screenshot' : 'Save the viewport as PNG'}
      className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-60"
    >
      Screenshot
    </button>
  );
}

function UndoIcon({ redo = false }: { redo?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={redo ? { transform: 'scaleX(-1)' } : undefined}
    >
      <path d="M9 14L4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

/** Undo / redo of the active file (per-file stacks; queued behind pending edits). */
function UndoRedo() {
  const canUndo = useViewerStore(
    (s) => (s.files.find((f) => f.id === s.activeFileId)?.undo.length ?? 0) > 0,
  );
  const canRedo = useViewerStore(
    (s) => (s.files.find((f) => f.id === s.activeFileId)?.redo.length ?? 0) > 0,
  );
  const cls =
    'flex h-[30px] w-[30px] items-center justify-center rounded-md border border-border bg-panel text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:text-faint disabled:hover:bg-panel';
  return (
    <>
      <button
        type="button"
        onClick={undoAction}
        disabled={!canUndo}
        title="Undo (Ctrl Z)"
        aria-label="Undo"
        className={cls}
      >
        <UndoIcon />
      </button>
      <button
        type="button"
        onClick={redoAction}
        disabled={!canRedo}
        title="Redo (Ctrl Shift Z)"
        aria-label="Redo"
        className={cls}
      >
        <UndoIcon redo />
      </button>
    </>
  );
}

/** "Export…" for the active file, with its unsaved-edit count as a badge. */
function ExportButton({ onExport }: { onExport?: () => void }) {
  const hasFile = useViewerStore((s) => s.activeFileId !== undefined);
  const count = useViewerStore((s) => {
    const f = s.files.find((x) => x.id === s.activeFileId);
    return f ? unsavedCount(f) : 0;
  });
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={!hasFile || !onExport}
      title={hasFile ? 'Export the active file as model.pt' : 'Open a model.pt to export it'}
      aria-label={
        count > 0 ? `Export… (${count} unsaved ${count === 1 ? 'edit' : 'edits'})` : 'Export…'
      }
      className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium whitespace-nowrap text-panel hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <DownloadIcon />
      <span className="max-[900px]:hidden">Export…</span>
      {count > 0 && (
        <span className="min-w-[18px] rounded-full bg-white/25 px-1.5 text-center text-[11px] leading-[18px] font-semibold">
          {count}
        </span>
      )}
    </button>
  );
}

function CompareIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="5" width="7" height="14" rx="1.5" />
      <rect x="14" y="5" width="7" height="14" rx="1.5" />
      <path d="M12 3v18" />
    </svg>
  );
}

/** Toggles the diff view; a dot marks filled slots while the view is closed. */
function DiffButton() {
  const open = useViewerStore((s) => s.diff.open);
  const hasA = useViewerStore((s) => s.diff.a !== undefined);
  const hasB = useViewerStore((s) => s.diff.b !== undefined);
  const toggleDiff = useViewerStore((s) => s.toggleDiff);
  const filled =
    hasA && hasB ? 'slots A and B set' : hasA ? 'slot A set' : hasB ? 'slot B set' : '';
  const dot = !open && filled !== '';
  const title = open ? 'Close the diff view' : dot ? `Diff (${filled})` : 'Compare two models';
  return (
    <button
      type="button"
      onClick={toggleDiff}
      aria-pressed={open}
      title={title}
      aria-label={dot ? `Diff (${filled})` : 'Diff'}
      className={`relative flex h-[30px] items-center gap-1.5 rounded-md border px-3 text-[13px] whitespace-nowrap ${
        open
          ? 'border-accent bg-accent-bg font-medium text-accent'
          : 'border-border bg-panel text-text hover:bg-row-alt'
      }`}
    >
      <CompareIcon />
      <span className="max-[900px]:hidden">Diff</span>
      {dot && (
        <span
          className="absolute -top-[3px] -right-[3px] h-1.5 w-1.5 rounded-full bg-accent ring-2 ring-panel"
          aria-hidden="true"
        />
      )}
    </button>
  );
}

export interface TopBarProps {
  /** Opens the file picker. Wired by the Phase 2 loader; the button is disabled until then. */
  onOpenModel?: () => void;
  /** Opens the export dialog for the active file (rendered from Phase 5 on). */
  onExport?: () => void;
  /** Sidebar visibility (App-local UI state, not persisted). */
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

function SidebarIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function TopBar({ onOpenModel, onExport, sidebarOpen, onToggleSidebar }: TopBarProps) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border bg-panel px-3 sm:gap-4 sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-pressed={sidebarOpen}
        aria-controls="app-sidebar"
        title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border hover:bg-row-alt ${
          sidebarOpen ? 'bg-panel text-muted' : 'bg-accent-bg text-accent'
        }`}
      >
        <SidebarIcon />
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <img src={LOGO_SRC} alt="" width={26} height={26} className="h-[26px] w-[26px]" />
        <h1 className="text-[15px] font-semibold tracking-tight whitespace-nowrap text-brand-navy max-[800px]:hidden">
          TBP Model Viewer
        </h1>
      </div>
      <div className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
      <Breadcrumb />
      <div className="flex shrink-0 items-center gap-2">
        <UndoRedo />
        <div className="h-6 w-px shrink-0 bg-border" aria-hidden="true" />
        <button
          type="button"
          onClick={onOpenModel}
          disabled={!onOpenModel}
          title="Open one or more model.pt files"
          className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] whitespace-nowrap text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-60"
        >
          Open model…
        </button>
        <ExportButton onExport={onExport} />
        <DiffButton />
        <ScreenshotButton />
        <ThemeToggle />
      </div>
    </header>
  );
}
