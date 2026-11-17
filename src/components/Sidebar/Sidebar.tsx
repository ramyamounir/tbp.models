import { useEffect, useState, type ReactNode } from 'react';
import { openModelFile } from '../../loader/loadController';
import { isGraphDrag } from '../../state/graphDrag';
import { POINT_SIZE_MAX, POINT_SIZE_MIN, useViewerStore } from '../../state/store';
import { PanelTabs, TabPanel } from '../PanelTabs';
import { ColorModePanel } from './ColorModePanel';
import { DisplayAsPanel, Slider } from './DisplayAsPanel';
import { DisplayOptions } from './DisplayOptions';
import { DropZone } from './DropZone';
import { GraphList } from './GraphList';
import { listScope, multiKeysFor, resolveRowKeys, useEditUi } from '../../state/editUi';
import { LmActionsButton, LmSelector } from './LmSelector';
import { LoadError } from './LoadError';
import { OpenFilesList } from './OpenFilesList';
import { PosePanel } from './PosePanel';

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

type StyleTab = 'color' | 'display' | 'pose';
const STYLE_TABS: { id: StyleTab; label: string }[] = [
  { id: 'color', label: 'Color' },
  { id: 'display', label: 'Display' },
  { id: 'pose', label: 'Pose' },
];

/**
 * COLOR ("Color points by") | DISPLAY ("Display as" and the display toggles) | POSE (pose
 * vectors on every node) of the displayed graph; mirrors the inspector's COLOR / DISPLAY / POSE tabs for the child object.
 */
function StyleSection() {
  const [tab, setTab] = useState<StyleTab>('color');
  return (
    <section className="border-b border-border px-4 py-4 last:border-b-0">
      <PanelTabs<StyleTab>
        tabs={STYLE_TABS}
        value={tab}
        onChange={setTab}
        ariaLabel="Point style"
        idPrefix="sidebar-style"
      />
      <TabPanel idPrefix="sidebar-style" id={tab} className="mt-3">
        {tab === 'color' ? (
          <ColorModePanel />
        ) : tab === 'pose' ? (
          <PosePanel />
        ) : (
          <>
            <DisplayAsPanel />
            <div className="mt-3 border-t border-border pt-2">
              <DisplayOptions />
            </div>
          </>
        )}
      </TabPanel>
    </section>
  );
}

/**
 * Shown in place of `StyleSection` while the diff view is open: the diff panes colour nodes by
 * diff class and always draw points, so of the COLOR / DISPLAY options only the point size
 * applies there.
 */
function DiffStyleSection() {
  const pointSize = useViewerStore((s) => s.display.pointSize);
  const setDisplay = useViewerStore((s) => s.setDisplay);
  return (
    <SidebarSection title="Display">
      <Slider
        label="Point size"
        value={pointSize}
        unit="px"
        min={POINT_SIZE_MIN}
        max={POINT_SIZE_MAX}
        ariaLabel="Point size (pixels)"
        title="Dot diameter in CSS pixels"
        onChange={(v) => setDisplay({ pointSize: v })}
      />
      <p className="mt-2 text-[11px] text-faint">
        Colors show the diff classes. Close the diff view for color and display options.
      </p>
    </SidebarSection>
  );
}

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/**
 * Document-level `dragover` / `drop`: a file dropped anywhere never navigates the tab away and
 * opens every dropped file through the load queue (no extension/MIME filter — the zip signature
 * check decides). Graph-row drags are ignored entirely, so the `dropEffect` set by an LM button,
 * file row or diff slot in its own `dragover` is never overwritten here.
 */
function useDocumentFileDrop() {
  useEffect(() => {
    const onDragOver = (e: DragEvent) => {
      if (isGraphDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = hasFiles(e) ? 'copy' : 'none';
    };
    const onDrop = (e: DragEvent) => {
      if (isGraphDrag(e)) return;
      const t0 = performance.now();
      e.preventDefault();
      for (const file of Array.from(e.dataTransfer?.files ?? [])) openModelFile(file, t0);
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
 * Left sidebar (272 px): open files (or the drop zone when none is open), LM selector and graph
 * list; color mode, display options and pose vectors as COLOR / DISPLAY / POSE tabs. Collapsing only hides it, so the
 * document-level drop handler and component state stay alive. `onOpenModel` opens the shared
 * file picker of App (the "+ Open another model.pt" row).
 */
export function Sidebar({
  open = true,
  onOpenModel,
}: {
  open?: boolean;
  onOpenModel?: () => void;
}) {
  useDocumentFileDrop();
  const hasModel = useViewerStore((s) => s.model !== undefined);
  const fileCount = useViewerStore((s) => s.files.length);
  const loadGen = useViewerStore((s) => s.loadGen);
  const lmId = useViewerStore((s) => s.lmId);
  const lm = useViewerStore((s) => s.model?.lms[s.lmId]);
  const activeFileId = useViewerStore((s) => s.activeFileId);
  const diffOpen = useViewerStore((s) => s.diff.open);
  const graphCount = lm ? lm.graphIds.length + lm.unreadable.length : undefined;
  // "k / n" while the graph list has a multi-selection (rows that still exist only).
  const checked = useEditUi((s) => {
    if (!lm) return 0;
    const keys = multiKeysFor(s.multi, listScope(activeFileId, lmId));
    if (keys.length === 0) return 0;
    const r = resolveRowKeys(lm, keys);
    return r.graphIds.length + r.unreadable.length;
  });
  return (
    <aside
      id="app-sidebar"
      aria-label="Model and display options"
      hidden={!open}
      className={`w-[272px] shrink-0 flex-col overflow-y-auto border-r border-border bg-panel max-[640px]:absolute max-[640px]:inset-y-0 max-[640px]:left-0 max-[640px]:z-40 max-[640px]:max-w-[85vw] max-[640px]:shadow-xl ${open ? 'flex' : 'hidden'}`}
    >
      <SidebarSection title={fileCount > 0 ? `Open files · ${fileCount}` : 'Open files'}>
        {fileCount > 0 ? (
          <OpenFilesList onOpenModel={onOpenModel} />
        ) : (
          <>
            <DropZone />
            <LoadError />
          </>
        )}
      </SidebarSection>
      <SidebarSection title="Learning module" aside={<LmActionsButton />}>
        <LmSelector />
      </SidebarSection>
      <SidebarSection
        title={hasModel ? `Graphs in LM ${lmId}` : 'Graphs'}
        aside={
          graphCount !== undefined &&
          (checked > 0 ? (
            <span className="text-[11px] font-semibold text-accent">
              {checked} / {graphCount}
            </span>
          ) : (
            <span className="text-[11px] text-faint">{graphCount}</span>
          ))
        }
      >
        <GraphList key={`${activeFileId ?? ''}-${loadGen}-${lmId}`} />
      </SidebarSection>
      {diffOpen ? <DiffStyleSection /> : <StyleSection />}
    </aside>
  );
}
