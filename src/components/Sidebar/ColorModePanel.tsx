import { useMemo, type ReactNode } from 'react';
import type { ObjectGraph } from '../../model/types';
import { getGraph, useViewerStore, type ColorMode } from '../../state/store';
import { displayName } from '../../util/displayName';
import { scalarOptions } from '../../viewer/colors';
import { NO_SM_CHANNEL } from '../Viewport/StatusPill';

const has = (g: ObjectGraph, kind: 'sm' | 'lm', name: string) =>
  g.channels.some((c) => c.kind === kind && Object.prototype.hasOwnProperty.call(c.features, name));

function Option({
  checked,
  disabled,
  label,
  onSelect,
  children,
  title,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onSelect(): void;
  children?: ReactNode;
  title?: string;
}) {
  return (
    <div className={`py-1 ${disabled ? 'opacity-50' : ''}`} title={title}>
      <label
        className={`flex items-center gap-2 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <input
          type="radio"
          name="color-mode"
          checked={checked}
          disabled={disabled}
          onChange={onSelect}
          className="h-3.5 w-3.5 accent-accent"
        />
        <span className={`text-[13px] ${checked ? 'font-medium text-text' : 'text-text'}`}>
          {label}
        </span>
      </label>
      {children && <div className="mt-0.5 pl-[22px]">{children}</div>}
    </div>
  );
}

const sub = 'font-mono text-[11px] text-muted';
const select =
  'max-w-full rounded border border-border bg-panel px-1 py-0.5 font-mono text-[11px] text-text disabled:cursor-not-allowed';

/** "Color points by": All / SM feature / LM feature / Channel source / Scalar feature. */
export function ColorModePanel() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const mode = useViewerStore((s) => s.colorMode);
  const setColorMode = useViewerStore((s) => s.setColorMode);
  const graph = getGraph(model, lmId, graphId);
  const options = useMemo(() => scalarOptions(graph), [graph]);

  if (!graph) return <p className="text-xs text-faint">—</p>;

  const total = graph.channels.reduce((s, c) => s + c.n, 0);
  const smFeatures = (['hsv', 'rgba'] as const).filter((f) => has(graph, 'sm', f));
  const hasLm = has(graph, 'lm', 'object_id');
  const noSm = !graph.channels.some((c) => c.kind === 'sm');
  const smFeature = mode.kind === 'sm' ? mode.feature : smFeatures[0];
  const scalarIdx =
    mode.kind === 'scalar'
      ? options.findIndex((o) => o.feature === mode.feature && o.component === mode.component)
      : 0;
  const set = (m: ColorMode) => setColorMode(m);

  return (
    <div role="radiogroup" aria-label="Color points by">
      <Option checked={mode.kind === 'all'} label="All" onSelect={() => set({ kind: 'all' })}>
        <span className={sub}>uniform · {total.toLocaleString('en-US')} pts</span>
      </Option>

      <Option
        checked={mode.kind === 'sm'}
        disabled={smFeatures.length === 0}
        title={
          noSm
            ? NO_SM_CHANNEL
            : smFeatures.length === 0
              ? 'No SM channel with hsv or rgba in this graph'
              : undefined
        }
        label="SM feature"
        onSelect={() => smFeature && set({ kind: 'sm', feature: smFeature })}
      >
        {smFeatures.length > 0 ? (
          <select
            aria-label="SM feature"
            className={select}
            value={smFeature}
            onChange={(e) => set({ kind: 'sm', feature: e.currentTarget.value as 'hsv' | 'rgba' })}
          >
            {smFeatures.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        ) : (
          <span className={sub}>hsv / rgba</span>
        )}
      </Option>

      <Option
        checked={mode.kind === 'lm'}
        disabled={!hasLm}
        title={!hasLm ? 'No LM channel with object_id in this graph' : undefined}
        label="LM feature"
        onSelect={() => set({ kind: 'lm', feature: 'object_id' })}
      >
        <span className={sub}>object_id</span>
      </Option>

      <Option
        checked={mode.kind === 'channel'}
        label="Channel source"
        onSelect={() => set({ kind: 'channel' })}
      >
        <span className={sub}>one color per input channel</span>
      </Option>

      <Option
        checked={mode.kind === 'scalar'}
        disabled={options.length === 0}
        title={options.length === 0 ? 'No scalar features in this graph' : undefined}
        label="Scalar feature"
        onSelect={() => {
          const o = options[0];
          if (o) set({ kind: 'scalar', feature: o.feature, component: o.component });
        }}
      >
        {options.length > 0 && (
          <select
            aria-label="Scalar feature"
            className={select}
            value={Math.max(0, scalarIdx)}
            onChange={(e) => {
              const o = options[Number(e.currentTarget.value)];
              if (o) set({ kind: 'scalar', feature: o.feature, component: o.component });
            }}
          >
            {options.map((o, i) => (
              <option key={i} value={i} title={displayName(o.label).full}>
                {displayName(o.label).text}
              </option>
            ))}
          </select>
        )}
      </Option>
    </div>
  );
}
