/**
 * Right panel of the diff view (spec multi-file-edit-diff Phase 7a "Minimal right panel",
 * extended in Phase 7b "Summary panel", mockup 08): the drop hint, the single slot's model, or
 * the full summary of the comparison (the two compared channels, distance histogram and the
 * features table). While a node is
 * selected the node diff panel (`NodeDiff`) replaces the summary.
 */
import { useMemo, type ReactNode } from 'react';
import {
  featureStructure,
  type DiffResult,
  type FeatureStatus,
  type FeatureStructure,
  type PropertyResult,
} from '../../diff/compare';
import { featureKey, type DiffPropertyKey } from '../../diff/settings';
import type { DiffStatus, ResolvedSlot } from '../../diff/useDiff';
import { effectiveProperty, isValidSelection } from '../../diff/viewClasses';
import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { NodeDiff } from './NodeDiff';
import { formatDelta } from './diffFormat';
import { KindChip, SectionLabel as Label } from './parts';
import { SlotBadge } from './SlotStrip';
import type { Slot } from './slotDrop';

const DROP_HINT =
  'Drag a model from the list on the left into the empty slot, or use “Send to diff slot” in a row’s menu. Switch files in OPEN FILES to browse other models; the slots keep what you dropped.';

const SectionLabel = Label;
const n0 = (v: number) => v.toLocaleString('en-US');

function SingleSlot({ slot, resolved }: { slot: Slot; resolved: ResolvedSlot }) {
  const other = slot === 'a' ? 'B' : 'A';
  const n = resolved.channel.n;
  return (
    <>
      <SectionLabel>Diff</SectionLabel>
      <h2 className="mt-1 text-[18px] font-semibold text-text">Waiting for slot {other}</h2>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-bg p-3">
        <SlotBadge slot={slot} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <DisplayName value={resolved.file.name} className="text-[11px] text-muted" />
          <div className="flex min-w-0 items-baseline gap-1 font-mono text-[12px] font-semibold text-text">
            <span className="shrink-0">LM {resolved.ref.lmId} ›</span>
            <DisplayName value={resolved.ref.graphId} max={60} />
          </div>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted">
            <DisplayName value={resolved.ref.channel} max={40} />
            <KindChip kind={resolved.channel.kind} />
          </span>
          <span className="font-mono text-[11px] text-faint">
            {n.toLocaleString('en-US')} {n === 1 ? 'node' : 'nodes'}
          </span>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Drop a model on slot {other} to compare.
      </p>
      <p className="mt-2 text-[12px] leading-relaxed text-muted">{DROP_HINT}</p>
    </>
  );
}

/** The 16-bin distance histogram with the tolerance marker. */
function HistogramSection({ result, indexMode }: { result: DiffResult; indexMode: boolean }) {
  const h = result.histogram;
  const peak = Math.max(1, ...h.bins);
  const n = h.bins.length;
  const tolFrac = Math.min(1, Math.max(0, h.tol / h.max));
  const unit = h.unit === 'm' ? 'm' : '%R';
  const fmtU = (v: number) => formatDelta(v, unit);
  return (
    <section aria-label="Distance histogram" className="border-t border-border pt-4">
      <SectionLabel>
        {indexMode ? 'Position offset of matched pairs' : 'Distance to nearest B node'}
      </SectionLabel>
      <div className="relative mt-3 h-[72px]">
        <div className="flex h-full items-end gap-[3px]">
          {h.bins.map((v, k) => {
            const beyond = (k / n) * h.max >= h.tol;
            return (
              <div
                key={k}
                className={`min-w-0 flex-1 rounded-t-[2px] ${beyond ? 'bg-diff-changed' : 'bg-diff-equal'}`}
                style={{ height: v > 0 ? `${Math.max(3, (v / peak) * 100)}%` : 0 }}
                title={`${fmtU((k / n) * h.max)} – ${fmtU(((k + 1) / n) * h.max)}: ${n0(v)}`}
              />
            );
          })}
        </div>
        <div
          className="pointer-events-none absolute inset-y-0 w-px bg-text"
          style={{ left: `${tolFrac * 100}%` }}
          aria-hidden="true"
        />
        <span
          className="pointer-events-none absolute -top-1 ml-1 font-mono text-[10px] whitespace-nowrap text-text"
          style={
            tolFrac > 0.6
              ? { right: `${(1 - tolFrac) * 100}%`, marginRight: 4 }
              : { left: `${tolFrac * 100}%` }
          }
        >
          tol {fmtU(h.tol)}
        </span>
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-faint">
        <span>0</span>
        <span>{fmtU(h.max)}</span>
      </div>
    </section>
  );
}

const STATUS_RANK: Record<FeatureStatus, number> = { both: 0, width: 1, 'only-a': 2, 'only-b': 3 };

/** Presence of a feature in one slot's channel: its width in the slot colour, or a dashed gap. */
function PresenceCell({ slot, width, warn }: { slot: Slot; width?: number; warn?: boolean }) {
  const letter = slot.toUpperCase();
  if (width === undefined) {
    return (
      <span
        title={`Not in ${letter}`}
        aria-label={`not in ${letter}`}
        className="flex h-[18px] w-7 items-center justify-center rounded border border-dashed border-border text-[10px] text-faint"
      >
        –
      </span>
    );
  }
  return (
    <span
      title={`In ${letter} · ${width} ${width === 1 ? 'value' : 'values'} per node`}
      aria-label={`in ${letter}, width ${width}`}
      className={`flex h-[18px] w-7 items-center justify-center rounded font-mono text-[10px] font-semibold text-white ${
        slot === 'a' ? 'bg-slot-a' : 'bg-slot-b'
      } ${warn ? 'ring-2 ring-diff-changed' : ''}`}
    >
      {width}
    </span>
  );
}

const ROW_GRID = 'grid w-full grid-cols-[minmax(0,1fr)_28px_28px_66px] items-center gap-2';

interface FeatureRow {
  key: DiffPropertyKey;
  label: string;
  widthA?: number;
  widthB?: number;
  status: FeatureStatus;
  prop?: PropertyResult;
}

/**
 * One table for the features of the two channels: which side has each feature (and how many
 * values it holds per node), and for the features both sides have, the share of paired nodes
 * outside the tolerance. Features both have come first, then different widths, then the ones
 * only A or only B has. A compared row is a button that colours the panes by that feature.
 */
function FeaturesSection({
  structure,
  result,
}: {
  structure: readonly FeatureStructure[];
  result?: DiffResult;
}) {
  const property = useViewerStore((s) => s.diff.property);
  const setDiffProperty = useViewerStore((s) => s.setDiffProperty);
  const active = effectiveProperty(result, property);
  const rows = useMemo(() => {
    const propOf = (key: DiffPropertyKey) => result?.properties.find((p) => p.key === key);
    const out: FeatureRow[] = [
      {
        key: 'position',
        label: 'node position',
        widthA: 3,
        widthB: 3,
        status: 'both',
        prop: propOf('position'),
      },
      ...structure.map((f) => ({
        key: featureKey(f.name),
        label: f.name,
        widthA: f.widthA,
        widthB: f.widthB,
        status: f.status,
        prop: propOf(featureKey(f.name)),
      })),
    ];
    return out
      .map((r, k) => ({ r, k }))
      .sort((p, q) => STATUS_RANK[p.r.status] - STATUS_RANK[q.r.status] || p.k - q.k)
      .map((x) => x.r);
  }, [structure, result]);
  const count = (st: FeatureStatus) => structure.filter((f) => f.status === st).length;
  const tally: { n: number; text: string; cls: string }[] = [
    { n: count('both'), text: 'in both', cls: 'text-text' },
    { n: count('only-a'), text: 'only in A', cls: 'text-diff-only-a' },
    { n: count('only-b'), text: 'only in B', cls: 'text-diff-only-b' },
    {
      n: count('width'),
      text: count('width') === 1 ? 'width differs' : 'widths differ',
      cls: 'text-diff-changed',
    },
  ].filter((t, k) => k === 0 || t.n > 0);

  return (
    <section aria-label="Features" className="border-t border-border pt-4">
      <SectionLabel
        right={
          result && (
            <span className="text-[11px] text-faint">click to color by Δ · again to clear</span>
          )
        }
      >
        Features
      </SectionLabel>
      <p className="mt-1.5 flex flex-wrap gap-x-2 text-[11px]">
        {tally.map((t, k) => (
          <span key={t.text} className={t.cls}>
            {k > 0 && <span className="mr-2 text-faint">·</span>}
            <span className="font-mono font-semibold">{t.n}</span> {t.text}
          </span>
        ))}
      </p>
      <div className={`${ROW_GRID} mt-3 text-[10px] font-medium text-muted`}>
        <span>Feature</span>
        <span className="text-center text-slot-a">A</span>
        <span className="text-center text-slot-b">B</span>
        <span className="text-right">{result ? 'changed' : ''}</span>
      </div>
      <ul className="-mx-2 mt-1 flex flex-col">
        {rows.map((r) => {
          const p = r.prop;
          const compared = p?.compared === true;
          const on = compared && r.key === active;
          const share = p && p.paired > 0 ? p.outside / p.paired : 0;
          const pct = (share * 100).toFixed(1).replace(/\.0$/, '');
          let value: ReactNode;
          let valueCls = 'text-faint';
          let valueTitle: string | undefined;
          if (r.status === 'only-a') {
            value = 'only in A';
            valueCls = 'text-diff-only-a';
          } else if (r.status === 'only-b') {
            value = 'only in B';
            valueCls = 'text-diff-only-b';
          } else if (r.status === 'width') {
            value = 'width';
            valueCls = 'text-diff-changed';
            valueTitle = `Not compared: ${r.widthA} values per node in A, ${r.widthB} in B`;
          } else if (!result) {
            value = '';
          } else if (!compared) {
            value = 'off';
            valueTitle = 'Not compared: turned off in the diff settings';
          } else if (p.paired === 0) {
            value = '—';
            valueTitle = 'No paired nodes to compare';
          } else {
            value = `${pct} %`;
            valueCls = p.outside > 0 ? 'text-diff-changed' : 'text-diff-only-b';
            valueTitle = `${n0(p.outside)} of ${n0(p.paired)} paired nodes outside the tolerance`;
          }
          const head = (
            <span className={ROW_GRID}>
              <span
                className={`min-w-0 truncate font-mono text-[12px] ${
                  on
                    ? 'font-semibold text-accent'
                    : r.status === 'both' && (compared || !result)
                      ? 'text-text'
                      : 'text-muted'
                }`}
              >
                <DisplayName value={r.label} max={40} />
              </span>
              <PresenceCell slot="a" width={r.widthA} warn={r.status === 'width'} />
              <PresenceCell slot="b" width={r.widthB} warn={r.status === 'width'} />
              <span
                title={valueTitle}
                className={`truncate text-right font-mono text-[11px] font-semibold ${valueCls}`}
              >
                {value}
              </span>
            </span>
          );
          if (!compared || !p) {
            return (
              <li key={r.key} className="px-2 py-1.5">
                {head}
              </li>
            );
          }
          const tol =
            r.key === 'feature:object_id' || p.tol === 0
              ? 'exact'
              : `tol ${formatDelta(p.tol, p.unit)}`;
          const detail =
            p.paired === 0
              ? 'no paired nodes'
              : p.outside === 0
                ? 'equal'
                : r.key === 'feature:object_id'
                  ? `${n0(p.outside)} differ`
                  : `max ${formatDelta(p.max, p.unit)}`;
          return (
            <li key={r.key}>
              <button
                type="button"
                aria-pressed={on}
                onClick={() => setDiffProperty(on ? 'any' : r.key)}
                className={`flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left ${
                  on ? 'bg-accent-bg' : 'hover:bg-row-alt'
                }`}
              >
                {head}
                <span className="flex w-full items-center gap-2">
                  <span className="h-[5px] min-w-[24px] flex-1 overflow-hidden rounded-full bg-row-alt">
                    {p.outside > 0 && (
                      <span
                        className="block h-full rounded-full bg-diff-changed"
                        style={{ width: `${Math.max(2, share * 100)}%` }}
                      />
                    )}
                  </span>
                  <span className="shrink-0 text-right font-mono text-[10px] text-faint">
                    {detail} · {tol}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** The two compared channels: slot, model, channel name and kind, node count. */
function ComparedChannels({ a, b }: { a: ResolvedSlot; b: ResolvedSlot }) {
  return (
    <ul className="mt-2 flex flex-col gap-1">
      {(['a', 'b'] as const).map((s) => {
        const r = s === 'a' ? a : b;
        return (
          <li key={s} className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-text">
            <SlotBadge slot={s} size={18} />
            <span className="min-w-0 truncate">
              <DisplayName value={r.ref.channel} max={40} />
            </span>
            <KindChip kind={r.channel.kind} />
            <span className="ml-auto shrink-0 text-[11px] text-faint">
              {n0(r.channel.n)} {r.channel.n === 1 ? 'node' : 'nodes'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export function DiffSummary({ status }: { status: DiffStatus }) {
  const match = useViewerStore((s) => s.diff.settings.match);
  const selection = useViewerStore((s) => s.diff.selection);

  if (status.status === 'done' && isValidSelection(status.a.channel, status.b.channel, selection)) {
    return (
      <aside aria-label="Node diff" className="flex min-h-0 flex-1 flex-col">
        <NodeDiff a={status.a} b={status.b} result={status.result} selection={selection} />
      </aside>
    );
  }

  let body: ReactNode;
  if (status.status === 'empty') {
    body = (
      <>
        <SectionLabel>Diff</SectionLabel>
        <h2 className="mt-1 text-[18px] font-semibold text-text">Pick two models</h2>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">{DROP_HINT}</p>
      </>
    );
  } else if (status.status === 'single') {
    const resolved = status.slot === 'a' ? status.a : status.b;
    body = resolved ? <SingleSlot slot={status.slot} resolved={resolved} /> : null;
  } else {
    const { a, b } = status;
    const same = a.ref.graphId === b.ref.graphId;
    const header = (
      <>
        <SectionLabel>Diff · A vs B</SectionLabel>
        <h2
          className="mt-1 flex min-w-0 items-baseline gap-2 font-mono text-[20px] font-semibold text-text"
          title={same ? a.ref.graphId : `${a.ref.graphId} vs ${b.ref.graphId}`}
        >
          {same ? (
            <DisplayName value={a.ref.graphId} max={80} />
          ) : (
            <>
              <DisplayName value={a.ref.graphId} max={40} />
              <span className="shrink-0 font-sans text-[13px] font-normal text-faint">vs</span>
              <DisplayName value={b.ref.graphId} max={40} />
            </>
          )}
        </h2>
      </>
    );
    const structure =
      status.status === 'done'
        ? status.result.structure
        : featureStructure(status.a.channel, status.b.channel);
    body = (
      <div className="flex flex-col gap-4">
        <div>
          {header}
          <ComparedChannels a={a} b={b} />
          {status.status === 'comparing' && (
            <p className="mt-3 text-[12px] text-muted" role="status">
              Comparing…
            </p>
          )}
        </div>
        {status.status === 'done' && (
          <HistogramSection result={status.result} indexMode={match === 'index'} />
        )}
        <FeaturesSection
          structure={structure}
          result={status.status === 'done' ? status.result : undefined}
        />
      </div>
    );
  }
  return (
    <aside aria-label="Diff summary" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
    </aside>
  );
}
