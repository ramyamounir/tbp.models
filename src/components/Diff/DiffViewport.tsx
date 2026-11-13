/**
 * Panes of the diff view (spec multi-file-edit-diff Phase 7a "DiffViewport"): Overlay, Side by
 * side with linked cameras, A only and B only, the tools row and a legend floating in each pane. Every pane
 * has a header naming its slot(s), with the clear button; the swap button sits between the two
 * slots (between the panes in Side by side, in the header in Overlay). There is no separate slot
 * strip. With one
 * slot filled that model is shown alone and the other pane is a drop target; with none, both
 * panes are drop targets.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { NodeClass } from '../../diff/compare';
import type { DiffStatus, ResolvedSlot } from '../../diff/useDiff';
import {
  effectiveProperty,
  partnerOf,
  graphNodeCount,
  sideClasses,
  type DiffSide,
} from '../../diff/viewClasses';
import { useViewerStore, type DiffMode, type Tool } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import type {
  DiffScene,
  DiffSceneGraph,
  DiffSceneInput,
  DiffSceneNode,
} from '../../viewer/DiffScene';
import { setDiffScene } from '../../viewer/diffSceneRegistry';
import { DiffCanvas } from './DiffCanvas';
import { DiffLegend } from './DiffLegend';
import { openDiffSettings } from './diffUi';
import { GearIcon } from './parts';
import { CloseIcon, SlotBadge } from './SlotStrip';
import { useSlotDrop, type Slot } from './slotDrop';

const TOOLS: { tool: Tool; label: string; hint: string }[] = [
  {
    tool: 'orbit',
    label: 'Orbit',
    hint: 'Drag to orbit, middle-drag to pan, click a node to diff it',
  },
  { tool: 'pan', label: 'Pan', hint: 'Drag to pan' },
  { tool: 'pick', label: 'Pick', hint: 'Click a node to diff it (middle-drag to pan)' },
];

const MODES: { mode: DiffMode; label: string }[] = [
  { mode: 'overlay', label: 'Overlay' },
  { mode: 'side', label: 'Side by side' },
  { mode: 'a', label: 'A only' },
  { mode: 'b', label: 'B only' },
];

const group =
  'pointer-events-auto flex items-center gap-0.5 rounded-lg border border-border bg-panel p-1 shadow-sm';
const btn =
  'h-7 rounded-md px-2.5 text-[13px] whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50';
const idle = 'text-text hover:bg-row-alt';
const active = 'bg-accent-bg font-medium text-accent';

/** Classes drawn per side in each mode (spec "Overlay", "Side by side", "A only / B only"). */
const OVERLAY_A = [NodeClass.Equal, NodeClass.Changed, NodeClass.OnlyA, NodeClass.OnlyB];
const OVERLAY_B = [NodeClass.OnlyB];
const SIDE_A = [NodeClass.Equal, NodeClass.Changed, NodeClass.OnlyA];
const SIDE_B = [NodeClass.Equal, NodeClass.Changed, NodeClass.OnlyB];

const LEGEND_ORDER = [NodeClass.Equal, NodeClass.Changed, NodeClass.OnlyA, NodeClass.OnlyB];

interface PaneSpec {
  key: string;
  /** Sides drawn in this pane, in graph order (graph 0, graph 1). */
  sides: DiffSide[];
  /** Classes drawn per side. */
  classes: NodeClass[][];
  /** Slot a drop on this pane fills (undefined: not a drop target). */
  dropSlot?: Slot;
  /** Slot(s) named in the pane header. */
  header?: Slot | 'both';
}

function DropPane({ slot, filledOther }: { slot: Slot; filledOther: boolean }) {
  const { over, props } = useSlotDrop(slot);
  const letter = slot.toUpperCase();
  return (
    <div
      {...props}
      aria-label={`Drop a model to set slot ${letter}`}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col rounded-xl border-2 border-dashed border-accent bg-accent-bg ${
        over ? 'ring-2 ring-accent' : ''
      }`}
    >
      <div className="flex items-center gap-2 p-3">
        <SlotBadge slot={slot} />
        <span className="text-[12px] text-muted">empty</span>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 pb-10 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-accent text-accent">
          <svg
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 4v12M7 11l5 5 5-5M5 20h14" />
          </svg>
        </span>
        <p className="text-[14px] font-semibold text-accent">Drop to set slot {letter}</p>
        <p className="text-[12px] text-muted">
          Any model from any open file. Dropping on a filled slot replaces it.
        </p>
        {!filledOther && slot === 'a' && (
          <p className="text-[11px] text-faint">Dropping two selected models fills both slots.</p>
        )}
      </div>
    </div>
  );
}

/** A pane with a scene; a drop target for `spec.dropSlot` (accent outline while dragging). */
function ScenePane({
  spec,
  framed,
  header,
  children,
}: {
  spec: PaneSpec;
  framed: boolean;
  header?: ReactNode;
  children: ReactNode;
}) {
  const { over, props } = useSlotDrop(spec.dropSlot ?? 'a');
  const dropProps = spec.dropSlot ? props : {};
  return (
    <div
      {...dropProps}
      className={`relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
        framed ? 'rounded-xl border border-border bg-viewport' : ''
      } ${over && spec.dropSlot ? 'outline-2 outline-accent' : ''}`}
    >
      {header}
      <div className="relative min-h-0 flex-1">{children}</div>
    </div>
  );
}

/** One slot in a pane header: badge, `file · LM k › name`, node count, clear. A drop target. */
function SlotHeader({ slot, resolved }: { slot: Slot; resolved: ResolvedSlot }) {
  const setSlot = useViewerStore((s) => s.setSlot);
  const { over, props } = useSlotDrop(slot);
  const letter = slot.toUpperCase();
  return (
    <div
      {...props}
      aria-label={`Slot ${letter}`}
      className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 ${
        over ? 'bg-accent-bg ring-2 ring-accent' : ''
      }`}
    >
      <SlotBadge slot={slot} />
      <div className="flex min-w-0 items-baseline gap-1 font-mono text-[12px] font-semibold text-text">
        <DisplayName value={resolved.file.name} max={40} className="font-normal text-muted" />
        <span className="shrink-0 font-normal text-faint">· LM {resolved.ref.lmId} ›</span>
        <DisplayName value={resolved.ref.graphId} max={60} />
      </div>
      <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">
        {graphNodeCount(resolved.graph).toLocaleString('en-US')} nodes
      </span>
      <button
        type="button"
        onClick={() => setSlot(slot, undefined)}
        title={`Clear slot ${letter}`}
        aria-label={`Clear slot ${letter}`}
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-row-alt hover:text-text"
      >
        <CloseIcon size={12} />
      </button>
    </div>
  );
}

function PaneHeader({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 items-center gap-2 px-1.5 pt-2 pb-1">{children}</div>;
}

/** Exchanges slots A and B; grows on hover so it reads as a control, not a decoration. */
function SwapButton({ className = '' }: { className?: string }) {
  const swapSlots = useViewerStore((s) => s.swapSlots);
  return (
    <button
      type="button"
      onClick={swapSlots}
      title="Swap A and B"
      aria-label="Swap A and B"
      className={`pointer-events-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-panel text-muted shadow-sm transition-transform duration-150 hover:scale-125 hover:border-accent hover:text-accent focus-visible:scale-125 focus-visible:text-accent active:scale-110 ${className}`}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M4 8h14l-4-4M20 16H6l4 4" />
      </svg>
    </button>
  );
}

export function DiffViewport({ status }: { status: DiffStatus }) {
  const diff = useViewerStore((s) => s.diff);
  const pointSize = useViewerStore((s) => s.display.pointSize);
  const setDiffMode = useViewerStore((s) => s.setDiffMode);
  const setDiffSelection = useViewerStore((s) => s.setDiffSelection);
  // Tool and projection of the diff panes (view-local; the main viewport keeps its own).
  const [tool, setTool] = useState<Tool>('orbit');
  const [ortho, setOrtho] = useState(false);

  const a = status.status === 'empty' ? undefined : status.a;
  const b = status.status === 'empty' ? undefined : status.b;
  const result = status.status === 'done' ? status.result : undefined;
  const both = status.status === 'comparing' || status.status === 'done';
  const mode: DiffMode = both ? diff.mode : status.status === 'single' ? status.slot : 'overlay';
  const property = effectiveProperty(result, diff.property);
  const align = diff.settings.alignCentroids;
  const graphA = a?.graph;
  const graphB = b?.graph;
  const singleSlot = status.status === 'single' ? status.slot : undefined;

  const classesA = useMemo(
    () => (result ? sideClasses(result, 'a', property) : undefined),
    [result, property],
  );
  const classesB = useMemo(
    () => (result ? sideClasses(result, 'b', property) : undefined),
    [result, property],
  );

  const panes: PaneSpec[] = useMemo(() => {
    if (!both) {
      if (!singleSlot) return [];
      return [{ key: 'p0', sides: [singleSlot], classes: [OVERLAY_A], dropSlot: singleSlot }];
    }
    switch (mode) {
      case 'side':
        return [
          { key: 'p0', sides: ['a'], classes: [SIDE_A], dropSlot: 'a', header: 'a' },
          { key: 'p1', sides: ['b'], classes: [SIDE_B], dropSlot: 'b', header: 'b' },
        ];
      case 'a':
        return [{ key: 'p0', sides: ['a'], classes: [SIDE_A], dropSlot: 'a', header: 'a' }];
      case 'b':
        return [{ key: 'p0', sides: ['b'], classes: [SIDE_B], dropSlot: 'b', header: 'b' }];
      default:
        // Overlay holds both models: a drop on the cloud is ambiguous, so only the two slots in
        // the header take drops.
        return [{ key: 'p0', sides: ['a', 'b'], classes: [OVERLAY_A, OVERLAY_B], header: 'both' }];
    }
  }, [both, mode, singleSlot]);

  const hiddenKey = diff.hidden.join(',');
  const selection = diff.selection;

  /** Scene input of one pane. */
  const inputFor = useCallback(
    (spec: PaneSpec): DiffSceneInput => {
      const hidden = new Set(hiddenKey === '' ? [] : hiddenKey.split(',').map(Number));
      const graphOf = (side: DiffSide) => (side === 'a' ? graphA : graphB);
      const graphs: DiffSceneGraph[] = [];
      spec.sides.forEach((side, k) => {
        const g = graphOf(side);
        if (!g) return;
        // While comparing, B is not drawn in the overlay (its unmatched nodes are not known yet).
        if (!result && k > 0) return;
        const own = g.centroid;
        const offset = align ? own : (graphA?.centroid ?? own);
        const allowed = new Set<number>(spec.classes[k]);
        graphs.push({
          graph: g,
          offset: both ? offset : own,
          classes: result ? (side === 'a' ? classesA : classesB) : undefined,
          show: (cls) => allowed.has(cls) && !hidden.has(cls),
        });
      });
      const nodes: DiffSceneNode[] = [];
      if (selection && result && graphs.length > 0) {
        const partner = partnerOf(result, selection.side, selection.channel, selection.index);
        const other: DiffSide = selection.side === 'a' ? 'b' : 'a';
        const label = mode === 'side';
        const add = (side: DiffSide, index: number) => {
          const k = spec.sides.indexOf(side);
          if (k !== 0 && k !== 1) return;
          if (k >= graphs.length || index < 0) return;
          nodes.push({
            graph: k,
            channel: selection.channel,
            index,
            label: label ? `#${index}` : undefined,
          });
        };
        add(selection.side, selection.index);
        add(other, partner);
      }
      return { graphs, selection: nodes.length > 0 ? nodes : undefined };
    },
    [graphA, graphB, both, result, classesA, classesB, align, hiddenKey, selection, mode],
  );

  const inputs = useMemo(() => panes.map((p) => inputFor(p)), [panes, inputFor]);

  // ---- scenes and camera linking ------------------------------------------------------------
  const scenesRef = useRef<(DiffScene | null)[]>([null, null]);
  const [sceneGen, setSceneGen] = useState(0);
  const onReady0 = useCallback((s: DiffScene | null) => {
    scenesRef.current[0] = s;
    setDiffScene(0, s);
    setSceneGen((g) => g + 1);
  }, []);
  const onReady1 = useCallback((s: DiffScene | null) => {
    scenesRef.current[1] = s;
    setDiffScene(1, s);
    setSceneGen((g) => g + 1);
  }, []);

  useEffect(() => {
    const [s0, s1] = scenesRef.current;
    if (!s0 || !s1) return;
    s1.setCamera(s0.getCamera());
    let syncing = false;
    const link = (from: DiffScene, to: DiffScene) =>
      from.onCameraChange((cam) => {
        if (syncing) return;
        syncing = true;
        try {
          to.setCamera(cam);
        } finally {
          syncing = false;
        }
      });
    const off0 = link(s0, s1);
    const off1 = link(s1, s0);
    return () => {
      off0();
      off1();
    };
  }, [sceneGen]);

  const allScenes = () => scenesRef.current.filter((s): s is DiffScene => s !== null);

  const onPickFor = (spec: PaneSpec) => (node: DiffSceneNode) => {
    if (!result) return;
    const side = spec.sides[node.graph];
    if (!side) return;
    setDiffSelection({ side, channel: node.channel, index: node.index });
  };

  const filledSlot = status.status === 'single' ? status.slot : undefined;
  const hasScene = panes.length > 0;

  // ---- render -------------------------------------------------------------------------------
  const paneEls = panes.map((spec, k) => {
    const single = filledSlot ? (a ?? b) : undefined;
    let header: ReactNode;
    if (spec.header === 'both' && a && b) {
      header = (
        <PaneHeader>
          <SlotHeader slot="a" resolved={a} />
          <SwapButton />
          <SlotHeader slot="b" resolved={b} />
        </PaneHeader>
      );
    } else if (spec.header === 'a' && a) {
      header = (
        <PaneHeader>
          <SlotHeader slot="a" resolved={a} />
        </PaneHeader>
      );
    } else if (spec.header === 'b' && b) {
      header = (
        <PaneHeader>
          <SlotHeader slot="b" resolved={b} />
        </PaneHeader>
      );
    } else if (filledSlot && single) {
      header = (
        <PaneHeader>
          <SlotHeader slot={filledSlot} resolved={single} />
        </PaneHeader>
      );
    }
    return (
      <ScenePane key={spec.key} spec={spec} framed header={header}>
        <DiffCanvas
          input={inputs[k]}
          pointSize={pointSize}
          tool={tool}
          ortho={ortho}
          ariaLabel={k === 0 ? 'Diff point cloud' : 'Diff point cloud B'}
          onPick={onPickFor(spec)}
          onReady={k === 0 ? onReady0 : onReady1}
        />
        {result && classesA && classesB && (
          <DiffLegend
            result={result}
            classesA={classesA}
            classesB={classesB}
            show={LEGEND_ORDER.filter((c) => spec.classes.some((list) => list.includes(c)))}
          />
        )}
      </ScenePane>
    );
  });

  let body: ReactNode;
  if (status.status === 'empty') {
    body = (
      <div className="flex min-h-0 flex-1 gap-3 max-[1100px]:min-h-[360px] max-[1100px]:flex-col">
        <DropPane slot="a" filledOther={false} />
        <DropPane slot="b" filledOther={false} />
      </div>
    );
  } else if (filledSlot) {
    body = (
      <div className="flex min-h-0 flex-1 gap-3 max-[1100px]:min-h-[360px] max-[1100px]:flex-col">
        {filledSlot === 'b' && <DropPane key="drop-a" slot="a" filledOther />}
        {paneEls}
        {filledSlot === 'a' && <DropPane key="drop-b" slot="b" filledOther />}
      </div>
    );
  } else {
    body = (
      <div
        className={`relative flex min-h-0 flex-1 gap-3 max-[1100px]:min-h-[220px] ${
          mode === 'side' ? 'max-[1100px]:min-h-[360px] max-[1100px]:flex-col' : ''
        }`}
      >
        {paneEls}
        {mode === 'side' && (
          <SwapButton className="absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2" />
        )}
        {status.status === 'comparing' && (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="rounded-full border border-border bg-panel px-3 py-1 text-[12px] text-muted shadow-sm">
              Comparing…
            </span>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {hasScene && (
        <div className="flex shrink-0 flex-wrap items-start gap-3">
          <div role="toolbar" aria-label="Diff tools" className={group}>
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
          <div role="toolbar" aria-label="Diff view mode" className={group}>
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                aria-pressed={both && diff.mode === m.mode}
                disabled={!both}
                title={both ? undefined : 'Fill both slots to compare'}
                onClick={() => setDiffMode(m.mode)}
                className={`${btn} ${both && diff.mode === m.mode ? active : idle}`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <div role="toolbar" aria-label="Diff view controls" className={`${group} ml-auto`}>
            <button
              type="button"
              className={`${btn} ${idle}`}
              onClick={() => allScenes().forEach((s) => s.resetView())}
            >
              Reset view
            </button>
            <button
              type="button"
              className={`${btn} ${idle}`}
              onClick={() => allScenes().forEach((s) => s.fit())}
            >
              Fit
            </button>
            <button
              type="button"
              aria-pressed={ortho}
              title="Orthographic projection"
              className={`${btn} ${ortho ? active : idle}`}
              onClick={() => setOrtho((o) => !o)}
            >
              Ortho
            </button>
            <button
              type="button"
              title="Diff settings"
              aria-label="Diff settings"
              className={`${btn} ${idle} flex items-center`}
              onClick={openDiffSettings}
            >
              <GearIcon />
            </button>
          </div>
        </div>
      )}
      {body}
    </div>
  );
}
