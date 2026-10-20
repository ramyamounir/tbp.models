import { useViewerStore } from '../../state/store';

const AXES = [
  { k: 0, name: 'x', color: 'var(--axis-x)' },
  { k: 1, name: 'y', color: 'var(--axis-y)' },
  { k: 2, name: 'z', color: 'var(--axis-z)' },
] as const;

/** Wrap any angle into −180…180 for display / the slider. */
const wrap = (d: number) => {
  const w = ((((d + 180) % 360) + 360) % 360) - 180;
  return Number.isFinite(w) ? w : 0;
};

/** Object rotation (Euler XYZ degrees): x/y/z sliders + Reset. */
export function RotationPanel() {
  const deg = useViewerStore((s) => s.objectRotationDeg);
  const setRotation = useViewerStore((s) => s.setRotation);
  return (
    <section
      aria-label="Object rotation"
      className="pointer-events-auto w-[230px] rounded-lg border border-border bg-panel px-3 py-2.5 shadow-sm"
    >
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Object rotation
        </h3>
        <button
          type="button"
          className="text-[12px] font-medium text-accent hover:underline"
          onClick={() => setRotation([0, 0, 0])}
        >
          Reset
        </button>
      </div>
      {AXES.map(({ k, name, color }) => {
        const v = wrap(deg[k]);
        return (
          <label key={name} className="flex items-center gap-2 py-0.5">
            <span className="w-3 font-mono text-[12px]" style={{ color }}>
              {name}
            </span>
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={Math.round(v)}
              aria-label={`Rotation about ${name} (degrees)`}
              onChange={(e) => {
                const next: [number, number, number] = [deg[0], deg[1], deg[2]];
                next[k] = Math.min(180, Math.max(-180, Number(e.currentTarget.value)));
                setRotation(next);
              }}
              className="h-1 min-w-0 flex-1"
              style={{ accentColor: color }}
            />
            <span className="w-10 text-right font-mono text-[12px] text-text">
              {Math.round(v)}°
            </span>
          </label>
        );
      })}
      <p className="mt-1 text-[11px] text-faint">
        Points, normals &amp; child poses rotate together
      </p>
    </section>
  );
}
