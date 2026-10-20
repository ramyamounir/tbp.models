import { useMemo } from 'react';
import { getGraph, useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import {
  computeColoring,
  objectIdLabel,
  rgbToCss,
  viridisGradientCss,
  type CategoricalRow,
  type RGB,
} from '../../viewer/colors';
import { useThemeColors } from './useThemeColors';

function Swatch({ color, dimmed }: { color: RGB; dimmed?: boolean }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: rgbToCss(color), opacity: dimmed ? 0.5 : 1 }}
      aria-hidden="true"
    />
  );
}

function CategoricalLegendRow({ row }: { row: CategoricalRow }) {
  const res = row.resolution;
  const rawId = res.status === 'unresolved' ? res.id : undefined;
  return (
    <li className="flex min-w-0 items-center gap-2 py-0.5">
      <Swatch color={row.color} />
      <span className="flex min-w-0 flex-1 items-center gap-1 font-mono text-[12px] text-text">
        {row.lmPrefix !== undefined && (
          <span className="shrink-0 text-muted">LM {row.lmPrefix} ·</span>
        )}
        {res.status === 'unresolved' ? (
          <span className="truncate">{rawId}</span>
        ) : (
          <>
            <DisplayName value={objectIdLabel(res)} />
            {/* spec: legend row = `name (id) · count` */}
            <span className="shrink-0 text-[10px] text-faint" title={`object_id ${row.id}`}>
              ({row.id})
            </span>
          </>
        )}
        {res.status === 'ambiguous' && (
          <span
            className="shrink-0 rounded bg-row-alt px-1 font-sans text-[10px] text-muted"
            title={`several graphs in LM ${res.lmId} share this id; the file does not say which encoding was used`}
          >
            ambiguous
          </span>
        )}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-faint">
        {row.count.toLocaleString('en-US')}
      </span>
    </li>
  );
}

const fmt = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(3)).toString() : '—');

/** Legend for the categorical (object_id), channel-source and scalar color modes. */
export function Legend() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const colorMode = useViewerStore((s) => s.colorMode);
  const theme = useThemeColors();
  const graph = getGraph(model, lmId, graphId);
  const legend = useMemo(
    () => (model && graph ? computeColoring(model, graph, colorMode, theme).legend : null),
    [model, graph, colorMode, theme],
  );
  if (!legend) return null;

  const box =
    'pointer-events-auto w-[248px] max-h-[40vh] overflow-y-auto rounded-lg border border-border bg-panel/95 px-3 py-2.5 shadow-sm';
  const title = 'mb-1.5 text-[11px] font-medium text-muted';

  if (legend.kind === 'categorical') {
    return (
      <div className={box} aria-label="Color legend">
        <p className={title}>{legend.title}</p>
        <ul>
          {legend.rows.map((r) => (
            <CategoricalLegendRow key={r.key} row={r} />
          ))}
          {legend.dimmedCount > 0 && (
            <li className="flex items-center gap-2 py-0.5">
              <Swatch color={theme.dim} dimmed />
              <span className="flex-1 font-mono text-[12px] text-muted">no LM data (dimmed)</span>
              <span className="font-mono text-[11px] text-faint">
                {legend.dimmedCount.toLocaleString('en-US')}
              </span>
            </li>
          )}
          {legend.rows.length === 0 && legend.dimmedCount === 0 && (
            <li className="text-[12px] text-faint">no nodes</li>
          )}
        </ul>
      </div>
    );
  }

  if (legend.kind === 'channel') {
    return (
      <div className={box} aria-label="Color legend">
        <p className={title}>Channel source</p>
        <ul>
          {legend.rows.map((r) => (
            <li key={r.channel} className="flex min-w-0 items-center gap-2 py-0.5">
              <Swatch color={r.color} />
              <DisplayName value={r.channel} className="flex-1 font-mono text-[12px] text-text" />
              <span
                className={`shrink-0 rounded px-1 text-[10px] font-semibold ${
                  r.kind === 'sm' ? 'bg-ch-sm-bg text-ch-sm' : 'bg-ch-lm-bg text-ch-lm'
                }`}
              >
                {r.kind.toUpperCase()}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-faint">
                {r.count.toLocaleString('en-US')}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className={box} aria-label="Color legend">
      <p className={title}>
        Scalar · <DisplayName value={legend.label} className="font-mono text-text" />
      </p>
      {legend.noFinite ? (
        <p className="text-[12px] text-faint">no finite values</p>
      ) : (
        <>
          <div
            className="h-2.5 w-full rounded-sm"
            style={{ backgroundImage: viridisGradientCss() }}
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
            <span>{fmt(legend.min)}</span>
            <span>{fmt(legend.max)}</span>
          </div>
        </>
      )}
      <p className="mt-1.5 flex min-w-0 flex-wrap gap-x-1.5 text-[11px] text-faint">
        <span>colored:</span>
        {legend.channels.map((c) => (
          <DisplayName key={c} value={c} max={48} className="font-mono" />
        ))}
      </p>
      {legend.dimmedCount > 0 && (
        <p className="mt-0.5 text-[11px] text-faint">
          {legend.dimmedCount.toLocaleString('en-US')} nodes without this feature (dimmed)
        </p>
      )}
    </div>
  );
}
