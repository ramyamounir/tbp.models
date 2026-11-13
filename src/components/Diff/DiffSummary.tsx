/**
 * Right panel of the diff view (spec multi-file-edit-diff Phase 7a "Minimal right panel",
 * extended in Phase 7b "Summary panel", mockup 08): the drop hint, the single slot's model, or
 * the full summary of the comparison (verdict, node bars, class bar, distance histogram,
 * properties, structure) with the footer (Settings…, Copy A to…, Copy B to…). While a node is
 * selected the node diff panel (`NodeDiff`) replaces the summary.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { DiffResult } from '../../diff/compare';
import type { DiffStatus, ResolvedSlot } from '../../diff/useDiff';
import {
  effectiveProperty,
  graphNodeCount,
  isValidSelection,
  structureLines,
} from '../../diff/viewClasses';
import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { CopyToMenu } from '../Sidebar/CopyToMenu';
import { openDiffSettings } from './diffUi';
import { NodeDiff } from './NodeDiff';
import { btnSecondary, formatDelta } from './diffFormat';
import { CheckIcon, GearIcon, SectionLabel as Label, WarnIcon } from './parts';
import { SlotBadge } from './SlotStrip';
import type { Slot } from './slotDrop';

const DROP_HINT =
  'Drag a model from the list on the left into the empty slot, or use “Send to diff slot” in a row’s menu. Switch files in OPEN FILES to browse other models; the slots keep what you dropped.';

const SectionLabel = Label;
const n0 = (v: number) => v.toLocaleString('en-US');

function SingleSlot({ slot, resolved }: { slot: Slot; resolved: ResolvedSlot }) {
  const other = slot === 'a' ? 'B' : 'A';
  const n = graphNodeCount(resolved.graph);
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

/** NODES: A and B counts as bars, then the stacked class bar and its line. */
function NodesSection({ result }: { result: DiffResult }) {
  const c = result.counts;
  const top = Math.max(c.nA, c.nB, 1);
  const d = c.nB - c.nA;
  const total = c.equal + c.changed + c.onlyA + c.onlyB;
  const parts: { n: number; cls: string; label: string }[] = [
    { n: c.equal, cls: 'bg-diff-equal', label: 'equal' },
    { n: c.changed, cls: 'bg-diff-changed', label: 'changed' },
    { n: c.onlyA, cls: 'bg-diff-only-a', label: 'only in A' },
    { n: c.onlyB, cls: 'bg-diff-only-b', label: 'only in B' },
  ];
  return (
    <section aria-label="Nodes" className="border-t border-border pt-4">
      <SectionLabel
        right={
          d !== 0 ? (
            <span
              className={`font-mono text-[11px] ${d > 0 ? 'text-diff-only-b' : 'text-diff-only-a'}`}
            >
              {d > 0 ? '+' : '−'}
              {n0(Math.abs(d))} in B
            </span>
          ) : (
            <span className="font-mono text-[11px] text-faint">same count</span>
          )
        }
      >
        Nodes
      </SectionLabel>
      <div className="mt-2 flex flex-col gap-1.5">
        {(
          [
            ['A', c.nA, 'bg-slot-a', 'text-slot-a'],
            ['B', c.nB, 'bg-slot-b', 'text-slot-b'],
          ] as const
        ).map(([k, n, bar, text]) => (
          <div key={k} className="flex items-center gap-2">
            <span className={`w-3 shrink-0 text-[11px] font-semibold ${text}`}>{k}</span>
            <div className="h-2.5 min-w-0 flex-1">
              <div
                className={`h-full rounded-sm ${bar}`}
                style={{ width: `${(n / top) * 100}%` }}
              />
            </div>
            <span className="w-14 shrink-0 text-right font-mono text-[11px] text-text">
              {n0(n)}
            </span>
          </div>
        ))}
      </div>
      <div
        className="mt-3 flex h-2.5 gap-px overflow-hidden rounded-sm bg-row-alt"
        role="img"
        aria-label={parts.map((p) => `${p.n} ${p.label}`).join(', ')}
      >
        {total > 0 &&
          parts
            .filter((p) => p.n > 0)
            .map((p) => (
              <div
                key={p.label}
                className={p.cls}
                style={{ width: `${(p.n / total) * 100}%`, minWidth: 2 }}
                title={`${n0(p.n)} ${p.label}`}
              />
            ))}
      </div>
      <p className="mt-1.5 font-mono text-[11px] text-muted">
        {n0(c.equal)} equal · {n0(c.changed)} changed · {n0(c.onlyA)} only A · {n0(c.onlyB)} only B
      </p>
    </section>
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

function PropertiesSection({ result }: { result: DiffResult }) {
  const property = useViewerStore((s) => s.diff.property);
  const setDiffProperty = useViewerStore((s) => s.setDiffProperty);
  const active = effectiveProperty(result, property);
  return (
    <section aria-label="Properties" className="border-t border-border pt-4">
      <SectionLabel
        right={<span className="text-[11px] text-faint">click to color by Δ · again to clear</span>}
      >
        Properties
      </SectionLabel>
      <ul className="mt-2 -mx-2 flex flex-col">
        {result.properties.map((p) => {
          const share = p.paired > 0 ? p.outside / p.paired : 0;
          const on = p.key === active;
          const pct = (share * 100).toFixed(1).replace(/\.0$/, '');
          return (
            <li key={p.key}>
              <button
                type="button"
                disabled={!p.compared}
                aria-pressed={on}
                onClick={() => setDiffProperty(on ? 'any' : p.key)}
                className={`flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left disabled:cursor-default ${
                  on ? 'bg-accent-bg' : p.compared ? 'hover:bg-row-alt' : ''
                }`}
              >
                <span className="flex w-full items-baseline gap-2">
                  <span
                    className={`min-w-0 flex-1 truncate font-mono text-[12px] ${
                      on ? 'font-semibold text-accent' : p.compared ? 'text-text' : 'text-faint'
                    }`}
                  >
                    <DisplayName value={p.label} max={40} />
                  </span>
                  <span
                    className={`shrink-0 font-mono text-[12px] font-semibold ${
                      !p.compared
                        ? 'text-faint'
                        : p.outside > 0
                          ? 'text-diff-changed'
                          : 'text-diff-only-b'
                    }`}
                  >
                    {p.compared ? `${pct} %` : '—'}
                  </span>
                </span>
                <span className="flex w-full items-center gap-2">
                  <span className="h-[5px] min-w-0 flex-1 overflow-hidden rounded-full bg-row-alt">
                    {p.compared && p.outside > 0 && (
                      <span
                        className="block h-full rounded-full bg-diff-changed"
                        style={{ width: `${Math.max(2, share * 100)}%` }}
                      />
                    )}
                  </span>
                  <span className="w-[86px] shrink-0 text-right font-mono text-[10px] text-faint">
                    {!p.compared
                      ? 'not compared'
                      : p.outside === 0
                        ? 'equal'
                        : p.key === 'feature:object_id'
                          ? `${n0(p.outside)} differ`
                          : `max ${formatDelta(p.max, p.unit)}`}
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

function StructureSection({ a, b }: { a: ResolvedSlot; b: ResolvedSlot }) {
  const lines = useMemo(() => {
    const all = structureLines(a.graph, b.graph);
    return [...all.filter((l) => l.ok), ...all.filter((l) => !l.ok)];
  }, [a.graph, b.graph]);
  return (
    <section aria-label="Structure" className="border-t border-border pt-4">
      <SectionLabel>Structure</SectionLabel>
      <ul className="mt-2 flex flex-col gap-1.5">
        {lines.map((l, k) => (
          <li
            key={k}
            className={`flex items-start gap-2 text-[12px] ${l.ok ? 'text-text' : 'text-diff-changed'}`}
          >
            <span className={`mt-0.5 shrink-0 ${l.ok ? 'text-diff-only-b' : 'text-diff-changed'}`}>
              {l.ok ? <CheckIcon /> : <WarnIcon />}
            </span>
            <span className="min-w-0 break-words">{l.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Footer: Settings…, Copy A to…, Copy B to… (the Phase 3b chooser for that slot's model). */
function Footer({ a, b }: { a?: ResolvedSlot; b?: ResolvedSlot }) {
  const [menu, setMenu] = useState<{ slot: Slot; anchor: HTMLElement } | undefined>();
  const slotOf = (s: Slot) => (s === 'a' ? a : b);
  const open = menu ? slotOf(menu.slot) : undefined;
  const source = useMemo(
    () =>
      open
        ? { fileId: open.ref.fileId, lmId: open.ref.lmId, graphIds: [open.ref.graphId] }
        : undefined,
    [open],
  );
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
      <button type="button" className={btnSecondary} onClick={openDiffSettings}>
        <GearIcon />
        Settings…
      </button>
      {(['a', 'b'] as const).map((s) => {
        const r = slotOf(s);
        return (
          <button
            key={s}
            type="button"
            className={btnSecondary}
            disabled={!r}
            aria-haspopup="menu"
            title={
              r ? `Copy ${r.ref.graphId} to another LM or file` : `Slot ${s.toUpperCase()} is empty`
            }
            onClick={(e) => setMenu({ slot: s, anchor: e.currentTarget })}
          >
            Copy {s.toUpperCase()} to…
          </button>
        );
      })}
      {menu && source && (
        <CopyToMenu source={source} anchor={menu.anchor} onClose={() => setMenu(undefined)} />
      )}
    </div>
  );
}

export function DiffSummary({ status }: { status: DiffStatus }) {
  const match = useViewerStore((s) => s.diff.settings.match);
  const selection = useViewerStore((s) => s.diff.selection);
  const a = status.status === 'empty' ? undefined : status.a;
  const b = status.status === 'empty' ? undefined : status.b;

  if (status.status === 'done' && isValidSelection(status.a.graph, status.b.graph, selection)) {
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
    if (status.status === 'comparing') {
      body = (
        <>
          {header}
          <p className="mt-3 text-[12px] text-muted" role="status">
            Comparing…
          </p>
        </>
      );
    } else {
      const r = status.result;
      const equal = r.verdict === 'equal';
      body = (
        <div className="flex flex-col gap-4">
          <div>
            {/* Two different names need the full width: the verdict pill then sits below them. */}
            <div className={same ? 'flex items-start gap-2' : 'flex flex-col items-start gap-2'}>
              <div className={same ? 'min-w-0 flex-1' : 'w-full min-w-0'}>{header}</div>
              <span
                role="status"
                className={`${same ? 'mt-4 ' : ''}flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium ${
                  equal
                    ? 'bg-diff-only-b-bg text-diff-only-b'
                    : 'bg-diff-changed-bg text-diff-changed'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${equal ? 'bg-diff-only-b' : 'bg-diff-changed'}`}
                  aria-hidden="true"
                />
                {equal ? 'Equal within tolerance' : 'Different'}
              </span>
            </div>
          </div>
          <NodesSection result={r} />
          <HistogramSection result={r} indexMode={match === 'index'} />
          <PropertiesSection result={r} />
          <StructureSection a={a} b={b} />
        </div>
      );
    }
  }
  return (
    <aside aria-label="Diff summary" className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
      <Footer a={a} b={b} />
    </aside>
  );
}
