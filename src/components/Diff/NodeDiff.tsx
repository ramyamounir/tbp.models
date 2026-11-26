/**
 * Node diff panel (spec multi-file-edit-diff Phase 7b "Node diff panel", mockup 09): shown in the
 * right panel instead of the summary while `diff.selection` is set. The selected node and its
 * partner: header with previous / next node and close, the paired pose glyph (A solid, B
 * dashed, synced to the diff camera), the Feature / A / B / Δ table with rows outside tolerance
 * first, the "only differences" switch, and Prev / Next difference.
 *
 * Feature names are file data: rendered only as React text, looked up with `hasOwnProperty`
 * (`featureValues`) or `Map`s, keyed by `featureKey(name)`.
 */
import { useMemo, type ReactNode } from 'react';
import {
  channelFeatureNames,
  vectorAngleDeg,
  type DiffResult,
  type PropertyResult,
} from '../../diff/compare';
import { featureKey, type DiffPropertyKey } from '../../diff/settings';
import type { ResolvedSlot } from '../../diff/useDiff';
import {
  differenceList,
  differencePosition,
  partnerOf,
  stepDifference,
} from '../../diff/viewClasses';
import { resolveObjectId } from '../../model/hash';
import { useViewerStore, type DiffSelection } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { hsvToRgb, rgbToCss } from '../../viewer/colors';
import { usePrimaryDiffScene } from '../../viewer/diffSceneRegistry';
import { featureValues } from '../Inspector/activeNode';
import { poseRowLabels } from '../Inspector/featureRows';
import { fmt } from '../Inspector/format';
import { GlyphView, type GlyphContent } from '../Inspector/GlyphView';
import { CloseIcon } from './SlotStrip';
import { btnSecondary, formatDelta } from './diffFormat';
import { ArrowIcon, ChevronIcon, KindChip, SectionLabel } from './parts';

/** One table row. `outside` undefined = not compared (shown, never highlighted). */
interface Row {
  key: string;
  label: string;
  sub?: string;
  a?: ReactNode;
  b?: ReactNode;
  delta?: number;
  tol?: number;
  unit: PropertyResult['unit'];
  outside?: boolean;
  /** object_id: delta is "same" / "differs". */
  identity?: boolean;
}

function values(v: ArrayLike<number> | undefined): ReactNode {
  if (!v) return <span className="text-faint">—</span>;
  return (
    <span className="break-words">
      {Array.from(v, (x) => fmt(x, Math.abs(x) >= 100 ? 1 : 3)).join(' ')}
    </span>
  );
}

const isColor = (f: string): f is 'hsv' | 'rgba' => f === 'hsv' || f === 'rgba';

/** Values of a color feature with a swatch of the color (hsv in 0…1, rgba in 0…255). */
function colorSwatch(v: ArrayLike<number> | undefined, kind: 'hsv' | 'rgba'): ReactNode {
  if (!v || v.length < 3 || !Array.from(v).slice(0, 3).every(Number.isFinite)) return values(v);
  const cl = (x: number) => Math.min(1, Math.max(0, x));
  const css =
    kind === 'hsv'
      ? rgbToCss(hsvToRgb(cl(v[0]), cl(v[1]), cl(v[2])))
      : rgbToCss([cl(v[0] / 255), cl(v[1] / 255), cl(v[2] / 255)]);
  const digits = kind === 'hsv' ? 2 : 1;
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={Array.from(v, (x) => fmt(x)).join(' ')}
    >
      <span
        className="inline-block h-3.5 w-3.5 shrink-0 rounded-sm border border-border"
        style={{ backgroundColor: css }}
        aria-hidden="true"
      />
      <span className="text-[10px] text-muted">
        {Array.from(v, (x) => fmt(x, digits)).join(' ')}
      </span>
    </span>
  );
}

/** Angle (degrees) between two 3-vectors; 180 when exactly one is zero-length, NaN if non-finite. */
function angleDeg(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const ok = (v: ArrayLike<number>) =>
    Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
  if (!ok(a) || !ok(b)) return NaN;
  return vectorAngleDeg(a[0], a[1], a[2], b[0], b[1], b[2]);
}

function objectIdText(r: ResolvedSlot, channel: string, v: ArrayLike<number> | undefined) {
  if (!v) return values(v);
  return (
    <span className="flex flex-col">
      {Array.from(v, (x, k) => {
        const res = resolveObjectId(r.file.view, channel, x);
        return (
          <span key={k} className="min-w-0 truncate">
            {res.status === 'resolved' ? (
              <DisplayName value={res.graphId} max={24} />
            ) : res.status === 'ambiguous' ? (
              `ambiguous (${res.candidates.length})`
            ) : (
              `${fmt(x, 0)} (unresolved)`
            )}
          </span>
        );
      })}
    </span>
  );
}

export function NodeDiff({
  a,
  b,
  result,
  selection,
}: {
  a: ResolvedSlot;
  b: ResolvedSlot;
  result: DiffResult;
  selection: DiffSelection;
}) {
  const setDiffSelection = useViewerStore((s) => s.setDiffSelection);
  const onlyDifferences = useViewerStore((s) => s.diff.onlyDifferences);
  const setOnly = useViewerStore((s) => s.setDiffOnlyDifferences);
  const scene = usePrimaryDiffScene();

  const partner = partnerOf(result, selection.side, selection.index);
  const ai = selection.side === 'a' ? selection.index : partner;
  const bi = selection.side === 'b' ? selection.index : partner;
  const chA = a.channel;
  const chB = b.channel;
  const own = selection.side === 'a' ? chA : chB;
  const paired = ai >= 0 && bi >= 0;
  const sameChannel = chA.channel === chB.channel && chA.kind === chB.kind;

  const diffList = useMemo(() => differenceList(result), [result]);
  const pos = differencePosition(result, diffList, selection);

  const step = (dir: -1 | 1) => {
    const next = stepDifference(result, diffList, selection, dir);
    if (next) setDiffSelection(next);
  };
  const stepNode = (dir: -1 | 1) => {
    const next = Math.min(own.n - 1, Math.max(0, selection.index + dir));
    if (next !== selection.index) setDiffSelection({ ...selection, index: next });
  };

  // ---- rows -----------------------------------------------------------------------------------
  const rows = useMemo(() => {
    const out: Row[] = [];
    const propOf = (key: DiffPropertyKey) => result.properties.find((p) => p.key === key);
    const compared = (key: DiffPropertyKey) => paired && result.changedMask.has(key);
    const deltaOf = (p: PropertyResult | undefined) => (p && ai >= 0 ? p.deltaA[ai] : NaN);
    const outsideOf = (key: DiffPropertyKey) =>
      compared(key) ? result.changedMask.get(key)![ai] === 1 : undefined;

    // node position (model frame)
    const posP = propOf('position');
    const pa = ai >= 0 ? chA.pos.subarray(3 * ai, 3 * ai + 3) : undefined;
    const pb = bi >= 0 ? chB.pos.subarray(3 * bi, 3 * bi + 3) : undefined;
    out.push({
      key: 'position',
      label: 'position',
      sub: 'model frame',
      a: values(pa),
      b: values(pb),
      delta: compared('position') ? deltaOf(posP) : undefined,
      tol: posP?.tol,
      unit: posP?.unit ?? '%R',
      outside: outsideOf('position'),
    });

    const names: string[] = [];
    for (const c of [chA, chB]) {
      for (const f of channelFeatureNames(c)) if (!names.includes(f)) names.push(f);
    }
    for (const f of names) {
      const key = featureKey(f);
      const p = propOf(key);
      const va = ai >= 0 ? featureValues(chA, ai, f) : undefined;
      const vb = bi >= 0 ? featureValues(chB, bi, f) : undefined;
      const isCompared = compared(key);
      if (f === 'pose_vectors' && p?.unit === '°' && (va?.length ?? vb?.length ?? 0) % 3 === 0) {
        const w = (va ?? vb)!.length;
        const labels = poseRowLabels(va ? chA : chB);
        for (let k = 0; k * 3 < w; k++) {
          const ra = va?.subarray(3 * k, 3 * k + 3);
          const rb = vb?.subarray(3 * k, 3 * k + 3);
          const d = isCompared && ra && rb ? angleDeg(ra, rb) : undefined;
          out.push({
            key: `${key}#${k}`,
            label: labels[k] ?? `vector ${k}`,
            sub: `pose_vectors[${k}]`,
            a: values(ra),
            b: values(rb),
            delta: d,
            tol: p.tol,
            unit: '°',
            outside: d === undefined ? undefined : !(d <= p.tol),
          });
        }
        continue;
      }
      out.push({
        key,
        label: f,
        sub: isColor(f) ? 'color' : undefined,
        a: isColor(f)
          ? colorSwatch(va, f)
          : f === 'object_id'
            ? objectIdText(a, chA.channel, va)
            : values(va),
        b: isColor(f)
          ? colorSwatch(vb, f)
          : f === 'object_id'
            ? objectIdText(b, chB.channel, vb)
            : values(vb),
        delta: isCompared ? deltaOf(p) : undefined,
        tol: p?.tol,
        unit: p?.unit ?? '',
        outside: outsideOf(key),
        identity: f === 'object_id',
      });
    }
    return out;
  }, [result, chA, chB, ai, bi, paired, a, b]);

  const outsideRows = rows.filter((r) => r.outside === true);
  const insideRows = rows.filter((r) => r.outside === false);
  const notCompared = rows.filter((r) => r.outside === undefined);
  const mask = result.changedMask;
  const mProps = paired ? mask.size : 0;
  const kProps = paired ? [...mask.values()].filter((m) => m[ai] === 1).length : 0;
  const shownRows = onlyDifferences ? outsideRows : [...outsideRows, ...insideRows, ...notCompared];
  const hiddenRows = onlyDifferences ? [...insideRows, ...notCompared] : [];

  // ---- glyph ------------------------------------------------------------------------------------
  const glyph = useMemo<GlyphContent | null>(() => {
    const ra = ai >= 0 ? featureValues(chA, ai, 'pose_vectors') : undefined;
    const rb = bi >= 0 ? featureValues(chB, bi, 'pose_vectors') : undefined;
    const ok = (v: Float64Array | undefined) =>
      v && v.length >= 9 ? Array.from(v.subarray(0, 9)) : null;
    const ga = ok(ra);
    const gb = ok(rb);
    if (!ga && !gb) return null;
    let worst: { row: number; text: string } | undefined;
    if (ga && gb) {
      let best = -1;
      for (let k = 0; k < 3; k++) {
        const d = angleDeg(ga.slice(3 * k, 3 * k + 3), gb.slice(3 * k, 3 * k + 3));
        if (Number.isFinite(d) && d > best) {
          best = d;
          worst = { row: k, text: formatDelta(d, '°') };
        }
      }
      if (best <= 0) worst = undefined;
    }
    return { kind: 'pair', a: ga, b: gb, worst };
  }, [chA, chB, ai, bi]);

  const nodeTitle = (
    <span className="flex flex-wrap items-baseline gap-x-2 font-mono text-[20px] font-semibold">
      {ai >= 0 ? <span className="text-slot-a">A #{ai}</span> : null}
      {paired && <span className="font-sans text-[12px] font-normal text-faint">vs</span>}
      {bi >= 0 ? <span className="text-slot-b">B #{bi}</span> : null}
      {!paired && (
        <span
          className={`font-sans text-[13px] font-medium ${
            ai >= 0 ? 'text-diff-only-a' : 'text-diff-only-b'
          }`}
        >
          only in {ai >= 0 ? 'A' : 'B'}
        </span>
      )}
    </span>
  );

  const iconBtn =
    'flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <div>
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="min-w-0 truncate text-[11px] font-semibold tracking-wide text-muted uppercase">
                  Node diff · <DisplayName value={chA.channel} max={40} />
                  {!sameChannel && (
                    <>
                      {' '}
                      vs <DisplayName value={chB.channel} max={40} />
                    </>
                  )}
                </p>
                {sameChannel ? (
                  <KindChip kind={chA.kind} />
                ) : (
                  chA.kind !== chB.kind && (
                    <>
                      <KindChip kind={chA.kind} />
                      <KindChip kind={chB.kind} />
                    </>
                  )
                )}
              </div>
              <div className="mt-1">{nodeTitle}</div>
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                className={iconBtn}
                aria-label="Previous node of the channel"
                title="Previous node of the channel"
                disabled={selection.index <= 0}
                onClick={() => stepNode(-1)}
              >
                <ChevronIcon dir="left" />
              </button>
              <button
                type="button"
                className={iconBtn}
                aria-label="Next node of the channel"
                title="Next node of the channel"
                disabled={selection.index >= own.n - 1}
                onClick={() => stepNode(1)}
              >
                <ChevronIcon dir="right" />
              </button>
              <button
                type="button"
                className={iconBtn}
                aria-label="Close node diff"
                title="Close node diff (Esc)"
                onClick={() => setDiffSelection(undefined)}
              >
                <CloseIcon size={12} />
              </button>
            </div>
          </div>
          <p
            className={`mt-1 text-[12px] ${
              !paired || kProps > 0 ? 'text-diff-changed' : 'text-diff-only-b'
            }`}
          >
            {!paired
              ? `no partner in ${ai >= 0 ? 'B' : 'A'} within the position tolerance`
              : kProps > 0
                ? `changed · ${kProps} of ${mProps} ${mProps === 1 ? 'feature' : 'features'} outside tolerance`
                : 'equal within tolerance'}
          </p>
        </div>

        {glyph && (
          <div>
            <GlyphView content={glyph} caption="solid = A · dashed = B" source={scene} />
          </div>
        )}

        <section aria-label="Node features">
          <SectionLabel
            right={
              <label className="flex cursor-pointer items-center gap-2 text-[12px] text-muted">
                only differences
                <button
                  type="button"
                  role="switch"
                  aria-checked={onlyDifferences}
                  onClick={() => setOnly(!onlyDifferences)}
                  className={`relative h-4 w-7 rounded-full transition-colors ${
                    onlyDifferences ? 'bg-accent' : 'bg-border'
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-3 w-3 rounded-full bg-panel transition-[left] ${
                      onlyDifferences ? 'left-3.5' : 'left-0.5'
                    }`}
                  />
                </button>
              </label>
            }
          >
            Features
          </SectionLabel>
          <div className="mt-2 overflow-hidden rounded-md border border-border">
            <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_64px] gap-2 bg-row-alt px-2.5 py-1.5 text-[11px] text-muted">
              <span>Feature</span>
              <span className="text-slot-a">A</span>
              <span className="text-slot-b">B</span>
              <span className="text-right">Δ / tol</span>
            </div>
            {shownRows.length === 0 && (
              <p className="px-2.5 py-2 text-[12px] text-faint">No feature outside tolerance.</p>
            )}
            {shownRows.map((r) => {
              const out = r.outside === true;
              const dim = r.outside !== true;
              return (
                <div
                  key={r.key}
                  className={`relative grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)_64px] gap-2 border-t border-border px-2.5 py-1.5 font-mono text-[11px] ${
                    out ? 'bg-diff-changed-bg' : ''
                  }`}
                >
                  {out && (
                    <span
                      className="absolute inset-y-0 left-0 w-[3px] bg-diff-changed"
                      aria-hidden="true"
                    />
                  )}
                  <span className={`min-w-0 ${dim ? 'opacity-70' : ''}`}>
                    <span
                      className={`block truncate ${out ? 'font-semibold text-text' : 'text-text'}`}
                    >
                      <DisplayName value={r.label} max={32} />
                    </span>
                    {r.sub && (
                      <span className="block truncate text-[10px] text-faint">
                        <DisplayName value={r.sub} max={32} />
                      </span>
                    )}
                  </span>
                  <span className={`min-w-0 text-text ${dim ? 'opacity-70' : ''}`}>{r.a}</span>
                  <span className={`min-w-0 text-text ${dim ? 'opacity-70' : ''}`}>{r.b}</span>
                  <span className="text-right">
                    {r.outside === undefined ? (
                      <span className="text-faint">—</span>
                    ) : (
                      <>
                        <span
                          className={`block font-semibold ${out ? 'text-diff-changed' : 'text-diff-only-b'}`}
                        >
                          {r.identity
                            ? out
                              ? 'differs'
                              : 'same'
                            : formatDelta(r.delta ?? NaN, r.unit)}
                        </span>
                        {!r.identity && r.tol !== undefined && (
                          <span className="block text-[10px] text-faint">
                            {out ? '>' : '≤'} {formatDelta(r.tol, r.unit)}
                          </span>
                        )}
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
          {hiddenRows.length > 0 && (
            <p className="mt-2 text-[11px] text-muted">
              {hiddenRows.length} more {insideRows.length === hiddenRows.length ? 'equal ' : ''}
              {hiddenRows.length === 1 ? 'feature' : 'features'} hidden ·{' '}
              {hiddenRows.map((r) => r.label).join(', ')}
            </p>
          )}
        </section>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border px-5 py-3">
        <button
          type="button"
          className={btnSecondary}
          disabled={diffList.length === 0}
          onClick={() => step(-1)}
          title="Previous difference (←)"
        >
          <ArrowIcon dir="left" />
          Prev difference
        </button>
        <button
          type="button"
          className={btnSecondary}
          disabled={diffList.length === 0}
          onClick={() => step(1)}
          title="Next difference (→)"
        >
          <ArrowIcon dir="right" />
          Next difference
        </button>
        <span className="ml-auto font-mono text-[11px] text-muted">
          {diffList.length === 0
            ? 'no differences'
            : `${pos >= 0 ? (pos + 1).toLocaleString('en-US') : '–'} / ${diffList.length.toLocaleString('en-US')}`}
        </span>
      </div>
    </div>
  );
}
