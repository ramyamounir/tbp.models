/**
 * Inspector COLOR / DISPLAY tabs for the child object of an LM node: the tab strip, the options
 * (the sidebar's, offered for the child graph) and the read-only child legend strip shown in the
 * child preview. The settings live in the store (`childColorMode` / `childDisplay`).
 */
import type { ReactNode } from 'react';
import type { ObjectGraph } from '../../model/types';
import { useViewerStore, type InspectorTab } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import type { ChildLook } from '../../viewer/ChildOverlay';
import {
  objectIdLabel,
  rgbToCss,
  viridisGradientCss,
  type Legend,
  type RGB,
} from '../../viewer/colors';
import { PanelTabs, TabPanel, type PanelTab } from '../PanelTabs';
import { ColorModeOptions } from '../Sidebar/ColorModePanel';
import { DisplayAsChoices } from '../Sidebar/DisplayAsPanel';

const TABS_ID = 'inspector';

/**
 * FEATURES | COLOR | DISPLAY; `tab` comes from `useInspectorTab`. COLOR and DISPLAY are disabled
 * (with `disabledTitle` as tooltip) while there is no child object to style.
 */
export function InspectorTabStrip({
  tab,
  disabledTitle,
}: {
  tab: InspectorTab;
  disabledTitle: string | null;
}) {
  const setTab = useViewerStore((s) => s.setInspectorTab);
  const off = { disabled: disabledTitle !== null, title: disabledTitle ?? undefined };
  const tabs: PanelTab<InspectorTab>[] = [
    { id: 'features', label: 'Features' },
    { id: 'color', label: 'Color', ...off },
    { id: 'display', label: 'Display', ...off },
  ];
  return (
    <PanelTabs<InspectorTab>
      tabs={tabs}
      value={tab}
      onChange={setTab}
      ariaLabel="Node details"
      idPrefix={TABS_ID}
    />
  );
}

export function InspectorTabPanel({ tab, children }: { tab: InspectorTab; children: ReactNode }) {
  return (
    <TabPanel idPrefix={TABS_ID} id={tab} className="mt-2">
      {children}
    </TabPanel>
  );
}

/** COLOR or DISPLAY options for the child object. */
export function ChildStylePanel({
  tab,
  child,
  look,
}: {
  tab: 'color' | 'display';
  child: ObjectGraph;
  look: ChildLook;
}) {
  const setMode = useViewerStore((s) => s.setChildColorMode);
  const setDisplay = useViewerStore((s) => s.setChildDisplay);
  return (
    <div>
      <p className="mb-1.5 flex min-w-0 items-center gap-1 text-[11px] text-faint">
        <span className="shrink-0">Applies to</span>
        <DisplayName value={child.graphId} max={40} />
        <span className="shrink-0">in the preview and overlay</span>
      </p>
      {tab === 'color' ? (
        <ColorModeOptions
          graph={child}
          mode={look.mode}
          onChange={setMode}
          name="child-color-mode"
          ariaLabel="Color child points by"
        />
      ) : (
        <DisplayAsChoices
          graph={child}
          display={look.display}
          onChange={setDisplay}
          name="child-display-as"
          ariaLabel="Display child as"
        />
      )}
    </div>
  );
}

/** Entries shown before "+N more". */
const STRIP_MAX = 4;

function Dot({ color, dimmed }: { color: RGB; dimmed?: boolean }) {
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: rgbToCss(color), opacity: dimmed ? 0.5 : 1 }}
      aria-hidden="true"
    />
  );
}

const fmtScalar = (v: number) => (Number.isFinite(v) ? Number(v.toPrecision(3)).toString() : '—');

interface StripEntry {
  key: string;
  name: string;
  content: ReactNode;
}

/**
 * Child legend: one line along the bottom of the child preview (categorical rows with their
 * counts and the dimmed row, channel sources, or the scalar range). Read-only; past `STRIP_MAX`
 * entries the rest collapse into "+N more" (names in its tooltip). Null when the mode has none.
 */
export function ChildLegendStrip({ legend, dim }: { legend: Legend | null; dim: RGB }) {
  if (!legend) return null;
  if (legend.kind === 'scalar') {
    return (
      <div className="flex min-w-0 items-center gap-1.5 font-mono text-[10px] text-muted">
        <DisplayName value={legend.label} max={28} />
        {legend.noFinite ? (
          <span className="text-faint">no finite values</span>
        ) : (
          <>
            <span>{fmtScalar(legend.min)}</span>
            <span
              className="inline-block h-1.5 w-16 shrink-0 rounded-sm"
              style={{ backgroundImage: viridisGradientCss() }}
              aria-hidden="true"
            />
            <span>{fmtScalar(legend.max)}</span>
          </>
        )}
      </div>
    );
  }
  const entries: StripEntry[] =
    legend.kind === 'categorical'
      ? legend.rows.map((r) => {
          const label = objectIdLabel(r.resolution);
          const prefix = r.lmPrefix !== undefined ? `LM ${r.lmPrefix} · ` : '';
          return {
            key: r.key,
            name: `${prefix}${label}`,
            content: (
              <>
                <Dot color={r.color} />
                {prefix && <span className="shrink-0 text-faint">{prefix}</span>}
                <DisplayName value={label} max={20} className="text-text" />
                <span className="shrink-0 text-faint">{r.count.toLocaleString('en-US')}</span>
              </>
            ),
          };
        })
      : legend.rows.map((r) => ({
          key: r.channel,
          name: r.channel,
          content: (
            <>
              <Dot color={r.color} />
              <DisplayName value={r.channel} max={20} className="text-text" />
              <span className="shrink-0 text-faint">{r.count.toLocaleString('en-US')}</span>
            </>
          ),
        }));
  if (legend.kind === 'categorical' && legend.dimmedCount > 0) {
    entries.push({
      key: 'dimmed',
      name: 'no LM data',
      content: (
        <>
          <Dot color={dim} dimmed />
          <span className="shrink-0 text-muted">no LM data</span>
          <span className="shrink-0 text-faint">{legend.dimmedCount.toLocaleString('en-US')}</span>
        </>
      ),
    });
  }
  const shown = entries.length > STRIP_MAX + 1 ? entries.slice(0, STRIP_MAX) : entries;
  const rest = entries.slice(shown.length);
  return (
    <ul
      aria-label="Child legend"
      className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[10px]"
    >
      {shown.map((e) => (
        <li key={e.key} className="flex min-w-0 max-w-full items-center gap-1">
          {e.content}
        </li>
      ))}
      {rest.length > 0 && (
        <li className="shrink-0 text-faint" title={rest.map((e) => e.name).join('\n')}>
          +{rest.length} more
        </li>
      )}
    </ul>
  );
}
