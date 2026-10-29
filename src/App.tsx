import { useEffect, useRef, useState } from 'react';
import { DisclaimerBanner } from './components/DisclaimerBanner';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Inspector } from './components/Inspector/Inspector';
import { Sidebar } from './components/Sidebar/Sidebar';
import { TopBar } from './components/TopBar';
import { Viewport } from './components/Viewport/Viewport';
import { openModelFile } from './loader/loadController';
import { installHistory } from './state/history';
import { installKeyboard } from './state/keyboard';
import { useViewerStore } from './state/store';

/** Below this width the sidebar starts collapsed (it can always be toggled from the top bar). */
const SIDEBAR_AUTO_COLLAPSE_PX = 800;

function initialSidebarOpen(): boolean {
  return typeof window === 'undefined' || window.innerWidth >= SIDEBAR_AUTO_COLLAPSE_PX;
}

export default function App() {
  const fileInput = useRef<HTMLInputElement>(null);
  // App-local UI state (not persisted; the theme is the only persisted setting).
  const [sidebarOpen, setSidebarOpen] = useState(initialSidebarOpen);
  const graphKey = useViewerStore((s) => `${s.loadGen}:${s.lmId}:${s.graphId ?? ''}`);
  useEffect(() => installKeyboard(), []);
  useEffect(() => installHistory(), []);
  return (
    <div className="flex h-full min-h-0 flex-col bg-bg text-text">
      {/* File picker behind the top bar's "Open model…" button. */}
      <input
        ref={fileInput}
        type="file"
        accept=".pt"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const t0 = performance.now();
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) openModelFile(file, t0);
        }}
      />
      <TopBar
        onOpenModel={() => fileInput.current?.click()}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((o) => !o)}
      />
      <DisclaimerBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} />
        {/* Viewport + inspector: side by side, or inspector as a bottom sheet under 1100 px. */}
        <div className="flex min-h-0 min-w-0 flex-1 max-[1100px]:flex-col">
          <ErrorBoundary name="Viewport" resetKey={graphKey} className="min-h-0 min-w-0 flex-1">
            <Viewport />
          </ErrorBoundary>
          <ErrorBoundary
            name="Inspector"
            resetKey={graphKey}
            className="w-[360px] shrink-0 border-l border-border max-[1100px]:h-[45%] max-[1100px]:w-full max-[1100px]:border-t max-[1100px]:border-l-0"
          >
            <Inspector />
          </ErrorBoundary>
        </div>
      </div>
    </div>
  );
}
