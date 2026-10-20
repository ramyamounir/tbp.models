import { useEffect, useRef } from 'react';
import { getGraph, useViewerStore } from '../../state/store';
import { createViewerScene } from '../../viewer/Scene';
import { setViewer } from '../../viewer/sceneRegistry';
import { AxisGizmo } from './AxisGizmo';
import { Legend } from './Legend';
import { RotationPanel } from './RotationPanel';
import { StatusPill } from './StatusPill';
import { ToolBar, ViewControls } from './ViewportToolbar';

/**
 * The 3D viewport: mounts the three.js scene (src/viewer/Scene.ts), registers it in the scene
 * registry, and overlays the toolbars, rotation panel, legend, axis gizmo and status pill.
 */
export function Viewport() {
  const hostRef = useRef<HTMLDivElement>(null);
  const hasModel = useViewerStore((s) => s.model !== undefined);
  const lmId = useViewerStore((s) => s.lmId);
  const hasGraph = useViewerStore((s) => getGraph(s.model, s.lmId, s.graphId) !== undefined);
  const nUnreadable = useViewerStore((s) => s.model?.lms[s.lmId]?.unreadable.length ?? 0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = createViewerScene(host);
    setViewer(scene);
    return () => {
      setViewer(null);
      scene.dispose();
    };
  }, []);

  return (
    <main
      aria-label="3D viewport"
      className="relative min-h-0 min-w-0 flex-1 overflow-hidden bg-viewport select-none"
    >
      <div ref={hostRef} className="absolute inset-0" />

      {!hasModel && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="max-w-sm text-center">
            <p className="text-sm font-medium text-text">No model loaded</p>
            <p className="mt-1 text-xs text-muted">
              Open a Monty <span className="font-mono">model.pt</span> to view its object graphs.
              The file is read locally in your browser and never uploaded.
            </p>
          </div>
        </div>
      )}
      {hasModel && !hasGraph && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center">
            <p className="text-sm font-medium text-muted">No graphs in LM {lmId}</p>
            {nUnreadable > 0 && (
              <p className="mt-1 text-xs text-faint">
                {nUnreadable} unreadable {nUnreadable === 1 ? 'graph' : 'graphs'} (see the sidebar
                for the reasons)
              </p>
            )}
          </div>
        </div>
      )}

      {hasGraph && (
        <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-4">
          <div className="flex items-start justify-between gap-3">
            <ToolBar />
            <div className="flex flex-col items-end gap-3">
              <ViewControls />
              <RotationPanel />
            </div>
          </div>
          <div className="flex items-end justify-between gap-3">
            <div className="flex flex-col items-start gap-2">
              <Legend />
              <AxisGizmo />
            </div>
            <div className="min-w-0">
              <StatusPill />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
