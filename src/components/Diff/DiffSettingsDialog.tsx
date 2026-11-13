/**
 * Diff settings dialog (spec multi-file-edit-diff Phase 7b "Settings dialog", mockup 07): slot
 * pickers (file / LM / model), node matching, the "EQUAL WITHIN" tolerance table with presets,
 * and a note listing the structural differences known before comparing. Everything is a draft
 * until Apply (one `setDiffSettings` plus `setSlot` for changed slots).
 *
 * Feature names are file data: the per-feature draft is a `Map` keyed by the raw name, React
 * keys are `featureKey(name)`, and names are rendered only as React text (`DisplayName`).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { diffRadius } from '../../diff/match';
import {
  applyPreset,
  DIFF_RANGES,
  EXACT_FEATURES,
  featureKey,
  featureTolerance,
  type DiffSettings,
  type PresetName,
  type PropertyTolerance,
} from '../../diff/settings';
import { resolveSlot } from '../../diff/useDiff';
import { graphNodeCount, structureLines } from '../../diff/viewClasses';
import type { ObjectGraph } from '../../model/types';
import { useViewerStore, type OpenFile, type SlotRef } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { formatMm } from '../Inspector/activeNode';
import { Dialog } from '../ui/Dialog';
import { closeDiffSettings } from './diffUi';
import { btnPrimary, btnSecondary, iconProps } from './diffFormat';
import { KindChip, WarnIcon } from './parts';
import { SlotBadge } from './SlotStrip';
import type { Slot } from './slotDrop';

/** A slot being edited: a file and LM, and a model once one is picked. */
interface SlotDraft {
  fileId?: string;
  lmId: number;
  graphId?: string;
}

const draftOf = (ref: SlotRef | undefined): SlotDraft =>
  ref ? { fileId: ref.fileId, lmId: ref.lmId, graphId: ref.graphId } : { lmId: 0 };

const sameRef = (d: SlotDraft, ref: SlotRef | undefined) =>
  d.fileId === ref?.fileId && d.graphId === ref?.graphId && (!ref || d.lmId === ref.lmId);

function refOf(files: readonly OpenFile[], d: SlotDraft): SlotRef | undefined {
  if (d.fileId === undefined || d.graphId === undefined) return undefined;
  const ref = { fileId: d.fileId, lmId: d.lmId, graphId: d.graphId };
  return resolveSlot(files, ref) ? ref : undefined;
}

/** First LM (from `prefer`) of a file with a readable graph, and its graph (same name if any). */
function pickIn(file: OpenFile, preferLm: number, preferGraph?: string): SlotDraft {
  const lms = file.view.lms;
  const order = [preferLm, ...lms.map((l) => l.lmId).filter((k) => k !== preferLm)];
  for (const k of order) {
    const lm = lms[k];
    if (!lm || lm.graphIds.length === 0) continue;
    const graphId =
      preferGraph !== undefined && lm.graphs.has(preferGraph) ? preferGraph : lm.graphIds[0];
    return { fileId: file.id, lmId: k, graphId };
  }
  return { fileId: file.id, lmId: Math.min(preferLm, Math.max(0, lms.length - 1)) };
}

const selectCls =
  'h-8 min-w-0 rounded-md border border-border bg-panel px-2 font-mono text-[12px] text-text disabled:opacity-50';

function SlotCard({
  slot,
  draft,
  files,
  onChange,
}: {
  slot: Slot;
  draft: SlotDraft;
  files: readonly OpenFile[];
  onChange(d: SlotDraft): void;
}) {
  const letter = slot.toUpperCase();
  const file = files.find((f) => f.id === draft.fileId);
  const lm = file?.view.lms[draft.lmId];
  const graph = draft.graphId !== undefined ? lm?.graphs.get(draft.graphId) : undefined;
  const n = graph ? graphNodeCount(graph) : 0;
  return (
    <div
      role="group"
      aria-label={`Slot ${letter}`}
      className={`flex min-w-0 flex-1 flex-col gap-2 rounded-[10px] border-2 p-3 ${
        slot === 'a' ? 'border-slot-a' : 'border-slot-b'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <SlotBadge slot={slot} />
        <span className="shrink-0 text-[11px] font-semibold tracking-wide text-muted uppercase">
          Slot {letter}
        </span>
        <div
          role="radiogroup"
          aria-label={`File of slot ${letter}`}
          className="ml-auto flex min-w-0 gap-0.5 overflow-x-auto rounded-md border border-border bg-bg p-0.5"
        >
          {files.map((f) => {
            const on = f.id === draft.fileId;
            return (
              <button
                key={f.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => !on && onChange(pickIn(f, draft.lmId, draft.graphId))}
                className={`h-6 max-w-[160px] min-w-0 shrink-0 rounded px-2 font-mono text-[11px] ${
                  on ? 'bg-panel font-semibold text-text shadow-sm' : 'text-faint hover:text-text'
                }`}
              >
                <DisplayName value={f.name} max={28} />
              </button>
            );
          })}
        </div>
      </div>
      <div className="flex min-w-0 gap-2">
        <select
          aria-label={`LM of slot ${letter}`}
          className={`${selectCls} w-[84px] shrink-0`}
          disabled={!file}
          value={file ? draft.lmId : ''}
          onChange={(e) => {
            if (!file) return;
            const k = Number(e.currentTarget.value);
            const next = file.view.lms[k];
            onChange({
              fileId: file.id,
              lmId: k,
              graphId:
                next && draft.graphId !== undefined && next.graphs.has(draft.graphId)
                  ? draft.graphId
                  : next?.graphIds[0],
            });
          }}
        >
          {!file && <option value="">LM –</option>}
          {file?.view.lms.map((l) => (
            <option key={l.lmId} value={l.lmId}>
              LM {l.lmId}
            </option>
          ))}
        </select>
        <select
          aria-label={`Model of slot ${letter}`}
          className={`${selectCls} flex-1`}
          disabled={!lm || lm.graphIds.length === 0}
          value={draft.graphId ?? ''}
          onChange={(e) => {
            const v = e.currentTarget.value;
            onChange({ ...draft, graphId: v === '' ? undefined : v });
          }}
        >
          <option value="">
            {lm && lm.graphIds.length === 0 ? 'no readable models' : '— empty —'}
          </option>
          {lm?.graphIds.map((g) => (
            <option key={g} value={g}>
              {g}
            </option>
          ))}
        </select>
      </div>
      <p className="truncate font-mono text-[11px] text-faint">
        {graph
          ? `${n.toLocaleString('en-US')} ${n === 1 ? 'node' : 'nodes'} · ${graph.channels
              .map((c) => c.channel)
              .join(', ')}`
          : 'empty · pick a model or drop one on the slot'}
      </p>
    </div>
  );
}

/** Number field that keeps the text while it is being typed and commits valid numbers. */
function NumberField({
  value,
  min,
  max,
  step,
  disabled,
  integer,
  label,
  onCommit,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  integer?: boolean;
  label: string;
  onCommit(v: number): void;
}) {
  const shown = integer ? String(value) : String(Number(value.toFixed(4)));
  const [text, setText] = useState(shown);
  const [editing, setEditing] = useState(false);
  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      value={editing ? text : shown}
      onFocus={() => {
        setText(shown);
        setEditing(true);
      }}
      onBlur={() => setEditing(false)}
      onChange={(e) => {
        const t = e.currentTarget.value;
        setText(t);
        const v = Number(t);
        if (t.trim() === '' || !Number.isFinite(v)) return;
        const c = Math.min(max, Math.max(min, integer ? Math.round(v) : v));
        onCommit(c);
      }}
      className="h-7 w-[64px] rounded-md border border-border bg-panel px-2 font-mono text-[12px] text-text disabled:opacity-50"
    />
  );
}

interface RowSpec {
  key: string;
  label: ReactNode;
  kind?: 'sm' | 'lm';
  metric: ReactNode;
  enabled: boolean;
  /** Row present in only one slot (listed, disabled). */
  only?: 'A' | 'B';
  onToggle?(on: boolean): void;
  tol?: {
    value: number;
    range: readonly [number, number];
    sliderMax?: number;
    step: number;
    unit: string;
    integer?: boolean;
    onChange(v: number): void;
    after?: ReactNode;
  };
  /** Right-hand note when there is no slider ("exact"). */
  note?: string;
}

function TolRow({ r }: { r: RowSpec }) {
  const off = !r.enabled || r.only !== undefined;
  const t = r.tol;
  const sliderMax = t ? (t.sliderMax ?? t.range[1]) : 1;
  return (
    <tr className="border-t border-border">
      <td className="w-8 py-2 pl-3">
        <input
          type="checkbox"
          aria-label={`Compare ${typeof r.label === 'string' ? r.label : r.key}`}
          checked={r.enabled && r.only === undefined}
          disabled={r.only !== undefined || !r.onToggle}
          onChange={(e) => r.onToggle?.(e.currentTarget.checked)}
          className="accent-[var(--accent)]"
        />
      </td>
      <td className={`py-2 pr-2 ${off ? 'opacity-50' : ''}`}>
        <span className="flex min-w-0 items-center gap-2 font-mono text-[12px] text-text">
          <span className="min-w-0 truncate">{r.label}</span>
          {r.kind && <KindChip kind={r.kind} />}
        </span>
      </td>
      <td
        className={`py-2 pr-2 text-[12px] text-muted max-[640px]:hidden ${off ? 'opacity-50' : ''}`}
      >
        {r.only ? `only in ${r.only}` : r.metric}
      </td>
      <td className="py-2 pr-3">
        <div className={`flex items-center gap-2 ${off ? 'opacity-50' : ''}`}>
          {t ? (
            <>
              <NumberField
                value={t.value}
                min={t.range[0]}
                max={t.range[1]}
                step={t.step}
                integer={t.integer}
                disabled={off}
                label={`Tolerance of ${typeof r.label === 'string' ? r.label : r.key}`}
                onCommit={t.onChange}
              />
              <span className="w-[44px] shrink-0 text-[11px] text-muted">{t.unit}</span>
              <input
                type="range"
                aria-hidden="true"
                tabIndex={-1}
                min={t.range[0]}
                max={sliderMax}
                step={t.step}
                value={Math.min(sliderMax, t.value)}
                disabled={off}
                onChange={(e) => t.onChange(Number(e.currentTarget.value))}
                className="h-1 min-w-[60px] flex-1 accent-[var(--accent)] max-[640px]:hidden"
              />
              <span className="w-[56px] shrink-0 text-right text-[11px] text-faint">
                {t.after ?? (t.value === 0 ? 'exact' : '')}
              </span>
            </>
          ) : (
            <>
              <span className="flex h-7 w-[64px] items-center rounded-md border border-border px-2 font-mono text-[12px] text-faint">
                –
              </span>
              <span className="ml-auto text-[11px] text-faint">{r.note ?? 'exact'}</span>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Feature name → where it appears in the two drafted graphs. */
interface FeatureInfo {
  inA: boolean;
  inB: boolean;
  kind: 'sm' | 'lm';
}

function featureInfo(a?: ObjectGraph, b?: ObjectGraph): Map<string, FeatureInfo> {
  const out = new Map<string, FeatureInfo>();
  const add = (g: ObjectGraph | undefined, side: 'inA' | 'inB') => {
    for (const c of g?.channels ?? []) {
      for (const f of Object.keys(c.features)) {
        if (!Object.prototype.hasOwnProperty.call(c.features, f)) continue;
        const have = out.get(f) ?? { inA: false, inB: false, kind: c.kind };
        have[side] = true;
        out.set(f, have);
      }
    }
  };
  add(a, 'inA');
  add(b, 'inB');
  return out;
}

/** `pose_vectors`, `hsv`, the others alphabetically, `object_id` last. */
function orderFeatures(names: Iterable<string>): string[] {
  const all = [...names];
  const first = ['pose_vectors', 'hsv'].filter((n) => all.includes(n));
  const rest = all
    .filter((n) => n !== 'pose_vectors' && n !== 'hsv' && n !== 'object_id')
    .sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));
  return [...first, ...rest, ...(all.includes('object_id') ? ['object_id'] : [])];
}

const PRESET_NAMES: { name: PresetName; label: string }[] = [
  { name: 'strict', label: 'Strict' },
  { name: 'default', label: 'Default' },
  { name: 'loose', label: 'Loose' },
];

export function DiffSettingsDialog() {
  const files = useViewerStore((s) => s.files);
  const storeA = useViewerStore((s) => s.diff.a);
  const storeB = useViewerStore((s) => s.diff.b);
  const storeSettings = useViewerStore((s) => s.diff.settings);
  const [rawA, setSlotA] = useState<SlotDraft>(() => draftOf(storeA));
  const [rawB, setSlotB] = useState<SlotDraft>(() => draftOf(storeB));
  const [draft, setDraft] = useState<DiffSettings>(storeSettings);

  // A drafted slot whose file was closed meanwhile reads as empty.
  const alive = (d: SlotDraft) => d.fileId === undefined || files.some((f) => f.id === d.fileId);
  const slotA: SlotDraft = alive(rawA) ? rawA : { lmId: 0 };
  const slotB: SlotDraft = alive(rawB) ? rawB : { lmId: 0 };

  const refA = refOf(files, slotA);
  const refB = refOf(files, slotB);
  const graphA = resolveSlot(files, refA)?.graph;
  const graphB = resolveSlot(files, refB)?.graph;
  const radius = useMemo(() => (graphA ? diffRadius(graphA) : 0), [graphA]);
  const features = useMemo(() => featureInfo(graphA, graphB), [graphA, graphB]);
  const structural = useMemo(
    () => (graphA && graphB ? structureLines(graphA, graphB).filter((l) => !l.ok) : []),
    [graphA, graphB],
  );

  /** Edit of the draft: any change other than a preset makes it 'custom'. */
  const edit = (patch: Partial<DiffSettings>) =>
    setDraft((d) => ({ ...d, ...patch, preset: 'custom' }));

  const setFeature = (name: string, t: PropertyTolerance) => {
    if (name === 'pose_vectors') edit({ poseVectorsDeg: t });
    else if (name === 'hsv') edit({ hsv: t });
    else if (name === 'object_id') edit({ objectId: { enabled: t.enabled } });
    else edit({ features: new Map(draft.features).set(name, t) });
  };

  const rows: RowSpec[] = [
    {
      key: 'position',
      label: 'node position',
      metric: 'distance',
      enabled: draft.positionEnabled,
      onToggle: (on) => edit({ positionEnabled: on }),
      tol: {
        value: draft.positionPct,
        range: DIFF_RANGES.positionPct,
        step: 0.1,
        unit: '% of R',
        onChange: (v) => edit({ positionPct: v }),
        after:
          graphA && radius >= 1e-9 ? `≈ ${formatMm((draft.positionPct / 100) * radius)}` : 'exact',
      },
    },
    {
      key: 'count',
      label: 'node count',
      metric: 'difference',
      enabled: draft.countEnabled,
      onToggle: (on) => edit({ countEnabled: on }),
      tol: {
        value: draft.countTol,
        range: DIFF_RANGES.countTol,
        sliderMax: 100,
        step: 1,
        integer: true,
        unit: 'nodes',
        onChange: (v) => edit({ countTol: Math.round(v) }),
      },
    },
  ];
  for (const name of orderFeatures(features.keys())) {
    const info = features.get(name)!;
    const only = info.inA && !info.inB ? 'A' : !info.inA && info.inB ? 'B' : undefined;
    const t = featureTolerance(draft, name);
    const base = {
      key: featureKey(name),
      label: <DisplayName value={name} max={40} />,
      kind: info.kind,
      enabled: t.enabled,
      only: graphA && graphB ? only : undefined,
      onToggle: (on: boolean) => setFeature(name, { enabled: on, tol: t.tol }),
    } as const;
    if (name === 'object_id') {
      rows.push({ ...base, metric: 'resolved graph name', note: 'exact' });
    } else if ((EXACT_FEATURES as readonly string[]).includes(name) && t.tol === 0) {
      rows.push({ ...base, metric: 'exact', note: 'exact' });
    } else {
      const range =
        name === 'pose_vectors'
          ? DIFF_RANGES.poseVectorsDeg
          : name === 'hsv'
            ? DIFF_RANGES.hsv
            : DIFF_RANGES.feature;
      rows.push({
        ...base,
        metric:
          name === 'pose_vectors'
            ? 'angle per vector'
            : name === 'hsv'
              ? 'per component, hue circular'
              : 'absolute',
        tol: {
          value: t.tol,
          range,
          step: name === 'pose_vectors' ? 0.5 : 0.01,
          unit: name === 'pose_vectors' ? '°' : '',
          onChange: (v) => setFeature(name, { enabled: t.enabled, tol: v }),
        },
      });
    }
  }

  const apply = () => {
    const s = useViewerStore.getState();
    s.setDiffSettings(draft);
    if (!sameRef(slotA, s.diff.a)) s.setSlot('a', refA);
    if (!sameRef(slotB, s.diff.b)) s.setSlot('b', refB);
    closeDiffSettings();
  };

  return (
    <Dialog
      open
      width={740}
      title="Diff settings"
      subtitle="Pick any model from any open file for each slot, or drag one in from the sidebar. A and B can be the same file."
      onCancel={closeDiffSettings}
      footer={
        <>
          <button
            type="button"
            onClick={() => setDraft((d) => applyPreset(d, 'default'))}
            className="mr-auto text-[13px] text-accent hover:underline"
          >
            Reset to defaults
          </button>
          <button type="button" onClick={closeDiffSettings} className={btnSecondary}>
            Cancel
          </button>
          <button type="button" onClick={apply} className={btnPrimary} data-autofocus>
            Apply
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-stretch gap-2 max-[640px]:flex-col">
          <SlotCard slot="a" draft={slotA} files={files} onChange={setSlotA} />
          <button
            type="button"
            title="Swap A and B"
            aria-label="Swap A and B"
            onClick={() => {
              setSlotA(slotB);
              setSlotB(slotA);
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center self-center rounded-full border border-border bg-panel text-muted hover:bg-row-alt hover:text-text"
          >
            <svg {...iconProps}>
              <path d="M4 8h14l-4-4M20 16H6l4 4" />
            </svg>
          </button>
          <SlotCard slot="b" draft={slotB} files={files} onChange={setSlotB} />
        </div>

        <section aria-labelledby="diff-matching">
          <p
            id="diff-matching"
            className="mb-2 text-[11px] font-semibold tracking-wide text-muted uppercase"
          >
            Node matching
          </p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 max-[640px]:grid-cols-1">
            {(
              [
                [
                  'nearest',
                  'Nearest node in space',
                  'Pairs each A node with the closest B node within the position tolerance',
                ],
                ['index', 'Same row index', 'Pairs row i of A with row i of B (same training run)'],
              ] as const
            ).map(([mode, label, hint]) => (
              <label key={mode} className="flex cursor-pointer items-start gap-2">
                <input
                  type="radio"
                  name="diff-match"
                  checked={draft.match === mode}
                  onChange={() => edit({ match: mode })}
                  className="mt-0.5 accent-[var(--accent)]"
                />
                <span>
                  <span className="block text-[13px] text-text">{label}</span>
                  <span className="block text-[11px] text-muted">{hint}</span>
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={draft.alignCentroids}
                onChange={(e) => edit({ alignCentroids: e.currentTarget.checked })}
                className="accent-[var(--accent)]"
              />
              <span className="text-[13px] text-text">Align centroids before matching</span>
            </label>
          </div>
        </section>

        <section aria-labelledby="diff-equal-within" className="border-t border-border pt-4">
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <p
              id="diff-equal-within"
              className="text-[11px] font-semibold tracking-wide text-muted uppercase"
            >
              Equal within
            </p>
            <span className="text-[11px] text-faint">
              values inside the tolerance count as equal; outside as different
            </span>
            <div
              role="radiogroup"
              aria-label="Tolerance preset"
              className="ml-auto flex gap-0.5 rounded-md border border-border bg-bg p-0.5"
            >
              {PRESET_NAMES.map((p) => {
                const on = draft.preset === p.name;
                return (
                  <button
                    key={p.name}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => setDraft((d) => applyPreset(d, p.name))}
                    className={`h-6 rounded px-3 text-[12px] ${
                      on
                        ? 'bg-panel font-semibold text-text shadow-sm'
                        : 'text-muted hover:text-text'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
              {draft.preset === 'custom' && (
                <span className="flex h-6 items-center px-2 text-[12px] text-accent">Custom</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[600px] border-collapse text-left max-[640px]:min-w-0">
              <thead className="bg-row-alt text-[11px] text-muted">
                <tr>
                  <th className="w-8 py-1.5 pl-3" aria-label="Compare" />
                  <th className="py-1.5 pr-2 font-medium">Property</th>
                  <th className="py-1.5 pr-2 font-medium max-[640px]:hidden">Metric</th>
                  <th className="py-1.5 pr-3 font-medium">Tolerance</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <TolRow key={r.key} r={r} />
                ))}
              </tbody>
            </table>
          </div>
          {structural.length > 0 && (
            <div
              role="note"
              className="mt-3 flex items-start gap-2 rounded-md bg-diff-changed-bg px-3 py-2 text-[12px] text-diff-changed"
            >
              <span className="mt-0.5 shrink-0">
                <WarnIcon />
              </span>
              <div className="min-w-0">
                <p>Reported as structural differences:</p>
                <ul className="mt-0.5 list-disc pl-4">
                  {structural.map((l, k) => (
                    <li key={k} className="break-words">
                      {l.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>
      </div>
    </Dialog>
  );
}
