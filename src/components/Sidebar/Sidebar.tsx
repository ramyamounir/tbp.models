import { useEffect, type ReactNode } from 'react';
import { openModelFile } from '../../loader/loadController';
import { useViewerStore } from '../../state/store';
import { ColorModePanel } from './ColorModePanel';
import { DisplayAsPanel } from './DisplayAsPanel';
import { DisplayOptions } from './DisplayOptions';
import { DropZone } from './DropZone';
import { GraphList } from './GraphList';
import { LmSelector } from './LmSelector';
import { LoadError } from './LoadError';
import { ModelSummary } from './ModelSummary';

/** Section heading + body; shared by the sidebar sections added in Phases 2, 3 and 5. */
export function SidebarSection({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold tracking-wide text-muted uppercase">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Document-level `dragover` / `drop`: a file dropped anywhere never navigates the tab away and
 * loads (first file only; no extension/MIME filter — the zip signature check decides).
 */
function useDocumentFileDrop() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) ? 'copy' : 'none';
    };
    const onDrop = (e: DragEvent) => {
      const t0 = performance.now();
      e.preventDefault();
      const file = e.dataTransfer?.files?.[0];
      if (file) openModelFile(file, t0);
    };
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('drop', onDrop);
    return () => {
      document.removeEventListener('dragover', onDragOver);
      document.removeEventListener('drop', onDrop);
    };
  }, []);
}

/**
 * Left sidebar (272 px): model (drop zone, progress, errors, summary), LM selector and graph
 * list (Phase 2); color mode and display options (Phase 3). Collapsing (Phase 5) only hides it, so the
 * document-level drop handler and component state stay alive.
 */
export function Sidebar({ open = true }: { open?: boolean }) {
  useDocumentFileDrop();
  const hasModel = useViewerStore((s) => s.model !== undefined);
  const loadGen = useViewerStore((s) => s.loadGen);
  const lmId = useViewerStore((s) => s.lmId);
  const lm = useViewerStore((s) => s.model?.lms[s.lmId]);
  const graphCount = lm ? lm.graphIds.length + lm.unreadable.length : undefined;
  return (
    <aside
      id="app-sidebar"
      aria-label="Model and display options"
      hidden={!open}
      className={`w-[272px] shrink-0 flex-col overflow-y-auto border-r border-border bg-panel ${open ? 'flex' : 'hidden'}`}
    >
      <SidebarSection title="Model">
        {hasModel ? (
          <>
            <DropZone compact />
            <LoadError />
            <div className="mt-3">
              <ModelSummary />
            </div>
          </>
        ) : (
          <>
            <DropZone />
            <LoadError />
          </>
        )}
      </SidebarSection>
      <SidebarSection title="Learning module">
        <LmSelector />
      </SidebarSection>
      <SidebarSection
        title={hasModel ? `Graphs in LM ${lmId}` : 'Graphs'}
        aside={
          graphCount !== undefined && <span className="text-[11px] text-faint">{graphCount}</span>
        }
      >
        <GraphList key={`${loadGen}-${lmId}`} />
      </SidebarSection>
      <SidebarSection title="Color points by">
        <ColorModePanel />
      </SidebarSection>
      <SidebarSection title="Display as">
        <DisplayAsPanel />
      </SidebarSection>
      <SidebarSection title="Display">
        <DisplayOptions />
      </SidebarSection>
    </aside>
  );
}
