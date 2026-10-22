import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ChannelGraph, ObjectGraph } from '../../model/types';
import { stepNode } from '../../state/keyboard';
import { getGraph, MATCH_RADIUS_MAX, MATCH_RADIUS_MIN, useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { ActiveNodeMarker } from '../../viewer/ActiveNodeMarker';
import { MatchSphere } from '../../viewer/MatchSphere';
import { useViewer } from '../../viewer/sceneRegistry';
import {
  activeNode,
  featureValues,
  findChannel,
  formatMm,
  EXACT_EPS_M,
  matchedNode,
  matchRadiusM,
  nodePos,
  type ActiveNode,
} from './activeNode';
import { InspectorTabPanel, InspectorTabStrip } from './ChildStyle';
import { poseRowLabels } from './featureRows';
import { SmFeatureTable } from './FeatureTable';
import { fmt } from './format';
import { GlyphView, type GlyphContent } from './GlyphView';
import { LmPanel } from './LmPanel';

function Badge({ kind }: { kind: 'sm' | 'lm' }) {
  return (
    <span
      className={`rounded px-1.5 py-px font-sans text-[10px] font-semibold ${
        kind === 'sm' ? 'bg-ch-sm text-panel' : 'bg-ch-lm text-panel'
      }`}
    >
      {kind === 'sm' ? 'SM' : 'LM'}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-panel text-[13px] text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/** "Match radius": no value shown; the viewport sphere shows it. */
function MatchRadiusSlider() {
  const pct = useViewerStore((s) => s.matchRadiusPct);
  const setPct = useViewerStore((s) => s.setMatchRadiusPct);
  return (
    <label
      className="mb-2 flex items-center gap-3"
      title="How far another channel's node may be from the selected node to count as at this location (shown as a sphere in the viewport; far left = exact matches only)"
    >
      <span className="shrink-0 text-[12px] text-text">Match radius</span>
      <input
        type="range"
        min={MATCH_RADIUS_MIN}
        max={MATCH_RADIUS_MAX}
        step={0.25}
        value={pct}
        onChange={(e) => setPct(Number(e.currentTarget.value))}
        className="min-w-0 flex-1 accent-accent"
        aria-label="Match radius"
      />
    </label>
  );
}

/**
 * Channel tabs: one per channel; the selection's tab says "this node", the others the node at
 * the same location (nearest within the match radius), or that there is none (tab disabled).
 */
function ChannelTabs({
  graph,
  selection,
  activeTab,
  radiusM,
}: {
  graph: ObjectGraph;
  selection: { channel: string; index: number };
  activeTab: string;
  radiusM: number;
}) {
  const setActiveTab = useViewerStore((s) => s.setActiveTab);
  const near = useMemo(() => {
    const own = findChannel(graph, selection.channel);
    const p = own && nodePos(own, selection.index);
    return graph.channels.map((c) =>
      c.channel === selection.channel ? null : p ? matchedNode(c, p, radiusM) : undefined,
    );
  }, [graph, selection, radiusM]);
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold tracking-wide text-muted uppercase">
          Channels at this location
        </h3>
        <span className="font-mono text-[11px] text-faint" title="Cycle tabs with [ and ]">
          [ / ]
        </span>
      </div>
      <MatchRadiusSlider />
      <div role="tablist" aria-label="Input channels" className="grid grid-cols-2 gap-2">
        {graph.channels.map((c, k) => {
          const selected = c.channel === activeTab;
          const n = near[k];
          const none = n === undefined;
          return (
            <button
              key={c.channel}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-disabled={(none && !selected) || undefined}
              title={none ? 'No node of this channel within the match radius' : undefined}
              onClick={() => (!none || selected) && setActiveTab(c.channel)}
              className={`min-w-0 rounded-lg border px-2.5 py-1.5 text-left ${
                selected
                  ? c.kind === 'sm'
                    ? 'border-ch-sm bg-ch-sm-bg'
                    : 'border-ch-lm bg-ch-lm-bg'
                  : none
                    ? 'cursor-not-allowed border-border bg-panel opacity-50'
                    : 'border-border bg-panel hover:bg-row-alt'
              }`}
            >
              <div className="flex min-w-0 font-mono text-[13px] text-text">
                <DisplayName value={c.channel} max={48} />
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                <Badge kind={c.kind} />
                <span className="truncate">
                  {n === null
                    ? 'this node'
                    : !n
                      ? 'none within radius'
                      : n.distM <= EXACT_EPS_M
                        ? `node #${n.index} · exact`
                        : `node #${n.index} · ${formatMm(n.distM)}`}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

const SM_NO_CHILD = 'Only LM nodes have a child object to color and display';

function SmPanel({ channel: c, index: i }: { channel: ChannelGraph; index: number }) {
  const content = useMemo<GlyphContent | null>(() => {
    const v = featureValues(c, i, 'pose_vectors');
    if (!v || v.length < 9) return null;
    const pfd = featureValues(c, i, 'pose_fully_defined');
    return {
      kind: 'sm',
      row9: Array.from(v.subarray(0, 9)),
      fullyDefined: pfd !== undefined && pfd[0] >= 0.5,
    };
  }, [c, i]);
  const [l0, l1, l2] = poseRowLabels(c);
  const legend: [string, string][] = [
    [l0, 'var(--glyph-normal)'],
    [l1, 'var(--glyph-curv1)'],
    [l2, 'var(--glyph-curv2)'],
  ];
  return (
    <div className="flex flex-col gap-3">
      <div>
        <GlyphView content={content} caption="view synced to viewport camera" />
        <div className="mt-1.5 flex gap-4 font-mono text-[11px] text-muted">
          {legend.map(([label, color]) => (
            <span key={label} className="inline-flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: color }} />
              {label}
            </span>
          ))}
        </div>
      </div>
      <section>
        <InspectorTabStrip tab="features" disabledTitle={SM_NO_CHILD} />
        <InspectorTabPanel tab="features">
          <SmFeatureTable channel={c} index={i} />
          <p className="mt-2 text-[11px] text-faint">
            Click a feature name to color the cloud by it.
          </p>
        </InspectorTabPanel>
      </section>
    </div>
  );
}

function nodeJson(lmId: number, graphId: string, c: ChannelGraph, i: number): string {
  const features = Object.fromEntries(
    Object.keys(c.features).map((k) => [k, Array.from(featureValues(c, i, k) ?? [])]),
  );
  const pos = [c.pos[3 * i], c.pos[3 * i + 1], c.pos[3 * i + 2]];
  return JSON.stringify({ lmId, graphId, channel: c.channel, index: i, pos, features }, null, 2);
}

function Footer({ json, rawRow }: { json: string; rawRow: string }) {
  const [copied, setCopied] = useState(false);
  const [fallback, setFallback] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const areaRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (fallback !== null) areaRef.current?.select();
  }, [fallback]);

  async function copy() {
    setFallback(null);
    try {
      if (!(window.isSecureContext && navigator.clipboard))
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(json);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setFallback(json);
    }
  }

  return (
    <div className="shrink-0 border-t border-border px-5 py-3">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-md border border-border bg-panel px-3 py-1.5 text-[12px] font-medium text-text hover:bg-row-alt"
        >
          {copied ? 'Copied' : 'Copy as JSON'}
        </button>
        <button
          type="button"
          aria-pressed={showRaw}
          onClick={() => setShowRaw(!showRaw)}
          className={`rounded-md border px-3 py-1.5 text-[12px] font-medium hover:bg-row-alt ${
            showRaw ? 'border-accent bg-accent-bg text-accent' : 'border-border bg-panel text-text'
          }`}
        >
          Show raw tensor row
        </button>
      </div>
      {showRaw && (
        <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-row-alt p-2 font-mono text-[11px] break-all whitespace-pre-wrap text-text">
          {rawRow}
        </pre>
      )}
      {fallback !== null && (
        <div className="mt-2">
          <textarea
            ref={areaRef}
            readOnly
            value={fallback}
            aria-label="Node as JSON"
            onFocus={(e) => e.currentTarget.select()}
            className="h-40 w-full resize-none rounded-md border border-border bg-row-alt p-2 font-mono text-[11px] text-text"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted">
            <span>Press Ctrl/⌘+C to copy</span>
            <button
              type="button"
              className="text-accent hover:underline"
              onClick={() => setFallback(null)}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Dashed ring at the active node while it differs from the selection (in viewer.overlayGroup). */
function useActiveNodeMarker(
  graph: ObjectGraph | undefined,
  active: ActiveNode | undefined,
  differs: boolean,
) {
  const viewer = useViewer();
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const markerRef = useRef<ActiveNodeMarker | null>(null);
  const ch = active ? findChannel(graph, active.channel) : undefined;
  const p = differs && ch && active ? nodePos(ch, active.index) : undefined;
  const px = p?.[0];
  const py = p?.[1];
  const pz = p?.[2];
  useEffect(() => {
    if (!viewer || px === undefined || py === undefined || pz === undefined) return;
    const m = new ActiveNodeMarker(
      viewer.overlayGroup,
      [px, py, pz],
      viewer.renderer.getPixelRatio(),
    );
    markerRef.current = m;
    return () => {
      m.dispose();
      markerRef.current = null;
    };
  }, [viewer, px, py, pz]);
  useEffect(() => {
    const id = requestAnimationFrame(() => markerRef.current?.recolor());
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);
}

/** Match-radius sphere around the selected node (in viewer.overlayGroup), following the slider. */
function useMatchSphere(
  graph: ObjectGraph | undefined,
  selection: { channel: string; index: number } | undefined,
  radiusM: number,
) {
  const viewer = useViewer();
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const sphereRef = useRef<MatchSphere | null>(null);
  const ch = selection ? findChannel(graph, selection.channel) : undefined;
  const p = ch && selection ? nodePos(ch, selection.index) : undefined;
  const px = p?.[0];
  const py = p?.[1];
  const pz = p?.[2];
  useEffect(() => {
    if (!viewer || px === undefined || py === undefined || pz === undefined) return;
    const s = new MatchSphere(viewer.overlayGroup, [px, py, pz]);
    sphereRef.current = s;
    return () => {
      s.dispose();
      sphereRef.current = null;
    };
  }, [viewer, px, py, pz]);
  useEffect(() => {
    sphereRef.current?.setRadius(radiusM);
  }, [radiusM, px, py, pz]);
  useEffect(() => {
    const id = requestAnimationFrame(() => sphereRef.current?.recolor());
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);
}

/**
 * Right-hand node inspector (360 px), shown while a node is selected: header for the active node,
 * channel tabs, synced glyph preview, feature table (SM or LM) and footer. See spec Phase 4.
 */
export function Inspector() {
  const model = useViewerStore((s) => s.model);
  const lmId = useViewerStore((s) => s.lmId);
  const graphId = useViewerStore((s) => s.graphId);
  const loadGen = useViewerStore((s) => s.loadGen);
  const selection = useViewerStore((s) => s.selection);
  const activeTab = useViewerStore((s) => s.activeTab);
  const setSelection = useViewerStore((s) => s.setSelection);
  const matchRadiusPct = useViewerStore((s) => s.matchRadiusPct);
  const graph = getGraph(model, lmId, graphId);
  const radiusM = useMemo(() => matchRadiusM(graph, matchRadiusPct), [graph, matchRadiusPct]);
  const active = useMemo(
    () => activeNode(graph, selection, activeTab, radiusM),
    [graph, selection, activeTab, radiusM],
  );
  const tab = activeTab ?? selection?.channel;
  const differs = !!selection && tab !== selection.channel;
  useActiveNodeMarker(graph, active, differs);
  useMatchSphere(graph, selection, radiusM);

  if (!selection || !graph || !model || graphId === undefined || tab === undefined) return null;
  const tabChannel = findChannel(graph, tab);
  const ch = active ? findChannel(graph, active.channel) : undefined;
  const idx = active?.index;
  const valid = ch !== undefined && idx !== undefined && idx >= 0 && idx < ch.n;
  const pos = valid ? [ch.pos[3 * idx], ch.pos[3 * idx + 1], ch.pos[3 * idx + 2]] : undefined;
  const nodeKey = JSON.stringify([loadGen, lmId, graphId, active?.channel ?? null, idx ?? null]);
  const step = (dir: -1 | 1) => stepNode(useViewerStore.getState(), dir);

  return (
    <aside
      aria-label="Node inspector"
      className="flex w-[360px] shrink-0 flex-col border-l border-border bg-panel max-[1100px]:h-[45%] max-[1100px]:w-full max-[1100px]:rounded-t-xl max-[1100px]:border-t max-[1100px]:border-l-0 max-[1100px]:shadow-[0_-4px_16px_rgb(0_0_0/0.08)]"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1 text-[11px] font-medium text-muted">
              <span className="shrink-0">NODE ·</span>
              <DisplayName value={tab} max={48} />
              {tabChannel && <Badge kind={tabChannel.kind} />}
            </div>
            <div className="mt-0.5 font-mono text-[22px] font-semibold text-text">
              {valid ? `#${idx}` : '—'}
            </div>
            {pos && (
              <div className="mt-0.5 font-mono text-[12px] text-muted">
                pos [{pos.map((v) => fmt(v, 4)).join(', ')}]{' '}
                <span className="text-faint">(model frame)</span>
              </div>
            )}
          </div>
          <div className="flex shrink-0 gap-1.5">
            <IconButton
              label="Previous node (←)"
              onClick={() => step(-1)}
              disabled={!valid || idx === 0}
            >
              ‹
            </IconButton>
            <IconButton
              label="Next node (→)"
              onClick={() => step(1)}
              disabled={!valid || idx === ch.n - 1}
            >
              ›
            </IconButton>
            <IconButton label="Close inspector (Esc)" onClick={() => setSelection(undefined)}>
              ×
            </IconButton>
          </div>
        </header>

        <div className="mt-4">
          <ChannelTabs graph={graph} selection={selection} activeTab={tab} radiusM={radiusM} />
        </div>

        <div className="mt-4">
          {!valid ? (
            <p className="text-[12px] text-faint">
              {differs
                ? 'No node of this channel within the match radius of the selected node. Widen the radius to match a nearby node.'
                : 'No nodes in this channel.'}
            </p>
          ) : ch.kind === 'sm' ? (
            <SmPanel channel={ch} index={idx} />
          ) : (
            <LmPanel model={model} channel={ch} index={idx} nodeKey={nodeKey} />
          )}
        </div>
      </div>
      {valid && (
        <Footer
          json={nodeJson(lmId, graphId, ch, idx)}
          rawRow={`x[${idx}] (F = ${ch.F})\n${fmtRaw(ch.x.subarray(idx * ch.F, (idx + 1) * ch.F))}`}
        />
      )}
    </aside>
  );
}

function fmtRaw(row: ArrayLike<number>): string {
  return `[${Array.from(row, (v) => String(v)).join(', ')}]`;
}
