import { useViewerStore, type DisplayOptions as Display } from '../../state/store';

function Toggle({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
  title?: string;
}) {
  return (
    <label
      className="relative flex cursor-pointer items-center justify-between gap-3 py-1.5"
      title={title}
    >
      <span className="text-[13px] text-text">{label}</span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative h-[18px] w-[30px] shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${
          checked ? 'bg-accent' : 'bg-border'
        }`}
      >
        <span
          className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-panel shadow transition-[left] ${
            checked ? 'left-[14px]' : 'left-[2px]'
          }`}
        />
      </span>
    </label>
  );
}

/** Surface normals, centering and channel dimming (point size lives in "Display as"). */
export function DisplayOptions() {
  const display = useViewerStore((s) => s.display);
  const setDisplay = useViewerStore((s) => s.setDisplay);
  const set = (patch: Partial<Display>) => setDisplay(patch);
  return (
    <div>
      <Toggle
        label="Show surface normals"
        checked={display.showNormals}
        onChange={(v) => set({ showNormals: v })}
      />
      <Toggle
        label="Center on centroid"
        checked={display.center}
        onChange={(v) => set({ center: v })}
      />
      <Toggle
        label="Dim nodes not in selected channel"
        checked={display.dimOthers}
        onChange={(v) => set({ dimOthers: v })}
        title="When a node is selected, dim every other channel"
      />
    </div>
  );
}
