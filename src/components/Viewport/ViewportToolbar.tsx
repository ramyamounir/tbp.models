import { useViewerStore, type Tool } from '../../state/store';
import { getViewer } from '../../viewer/sceneRegistry';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  { tool: 'orbit', label: 'Orbit', hint: 'Drag to orbit, click a node to select' },
  { tool: 'pan', label: 'Pan', hint: 'Drag to pan' },
  { tool: 'pick', label: 'Pick', hint: 'Click a node to select (drag does nothing)' },
  { tool: 'rotate', label: 'Rotate object', hint: 'Drag to rotate the object itself (R)' },
];

const group =
  'pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-panel p-1 shadow-sm';
const btn = 'h-7 rounded-md px-2.5 text-[13px]';
const idle = 'text-text hover:bg-row-alt';
const active = 'bg-accent-bg font-medium text-accent';

/** Tool selector (top-left). */
export function ToolBar() {
  const tool = useViewerStore((s) => s.tool);
  const setTool = useViewerStore((s) => s.setTool);
  return (
    <div role="toolbar" aria-label="Viewport tools" className={group}>
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          aria-pressed={tool === t.tool}
          title={t.hint}
          onClick={() => setTool(t.tool)}
          className={`${btn} ${tool === t.tool ? active : idle}`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Reset view / Fit / Ortho (top-right). */
export function ViewControls() {
  const ortho = useViewerStore((s) => s.ortho);
  const setOrtho = useViewerStore((s) => s.setOrtho);
  return (
    <div role="toolbar" aria-label="View controls" className={group}>
      <button type="button" className={`${btn} ${idle}`} onClick={() => getViewer()?.resetView()}>
        Reset view
      </button>
      <button
        type="button"
        className={`${btn} ${idle}`}
        title="Fit (F)"
        onClick={() => getViewer()?.fit()}
      >
        Fit
      </button>
      <button
        type="button"
        aria-pressed={ortho}
        title="Orthographic projection"
        className={`${btn} ${ortho ? active : idle}`}
        onClick={() => setOrtho(!ortho)}
      >
        Ortho
      </button>
    </div>
  );
}
