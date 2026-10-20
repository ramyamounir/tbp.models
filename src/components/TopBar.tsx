import { useState } from 'react';
import { useViewerStore, type Theme } from '../state/store';
import { getViewer, useViewer } from '../viewer/sceneRegistry';
import { downloadBlob, screenshotFileName } from '../viewer/screenshot';
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
      disabled={!viewer || busy}
      title="Save the viewport as PNG"
      className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-60"
    >
      Screenshot
    </button>
  );
}

export interface TopBarProps {
  /** Opens the file picker. Wired by the Phase 2 loader; the button is disabled until then. */
  onOpenModel?: () => void;
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

export function TopBar({ onOpenModel, sidebarOpen, onToggleSidebar }: TopBarProps) {
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
        <button
          type="button"
          onClick={onOpenModel}
          disabled={!onOpenModel}
          className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium whitespace-nowrap text-panel hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
        >
          Open model…
        </button>
        <ScreenshotButton />
        <ThemeToggle />
      </div>
    </header>
  );
}
