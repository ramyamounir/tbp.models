import { useEffect, useMemo, useState } from 'react';
import { resolveObjectId } from '../../model/hash';
import type { ChannelGraph, ModelFile, ObjectIdEncoding } from '../../model/types';
import { navigateToGraph } from '../../state/history';
import { useViewerStore } from '../../state/store';
import { readToken } from '../../theme/readToken';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import {
  buildChildObject,
  childHasPoints,
  lmNodePose,
  placeChildCloud,
} from '../../viewer/ChildOverlay';
import { cssToRgb, objectIdLabel } from '../../viewer/colors';
import { disposeObject } from '../../viewer/Glyphs';
import { useViewer } from '../../viewer/sceneRegistry';
import { useThemeColors } from '../Viewport/useThemeColors';
import { featureValues } from './activeNode';
import {
  ChildLegendStrip,
  ChildStylePanel,
  InspectorTabPanel,
  InspectorTabStrip,
} from './ChildStyle';
import { ColorTargetName, OrthoWarning, PoseMatrix, Table } from './FeatureTable';
import { genericRow, type RowSpec } from './featureRows';
import { fmt, fmtVec } from './format';
import { GlyphView, type GlyphContent } from './GlyphView';
import { useChildLook, useInspectorTab } from './useChildStyle';

const ENCODING_NOTE: Record<ObjectIdEncoding, string> = {
  sumOrd: 'sum(ord) (pre-v0.50 encoding)',
  sha256: 'SHA-256 (v0.50+ encoding)',
};

const AMBIGUOUS_HINT = 'Ambiguous object_id: choose a child graph first';

function sourceLm(channel: string): number | undefined {
  const m = /^learning_module_(\d+)$/.exec(channel);
  return m ? Number(m[1]) : undefined;
}

const LM_ORDER = [
  'object_id',
  'pose_vectors',
  'location_rel_model',
  'on_object',
  'pose_fully_defined',
];

/** Ring marking `location_rel_model` (matches the ring in the child preview). */
function AnchorRing() {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-select"
      aria-hidden="true"
    />
  );
}

/**
 * LM-channel node view: glyph (child triad + posed child preview with its legend and the
 * `location_rel_model` ring), FEATURES / COLOR / DISPLAY tabs (feature table with decoded
 * `object_id`; child colors and display), child-overlay toggle and "Open in LM s →" (spec Phase 4
 * "LM feature table", "Child overlay", "Ambiguous child ids").
 */
export function LmPanel({
  model,
  channel: c,
  index: i,
  nodeKey,
}: {
  model: ModelFile;
  channel: ChannelGraph;
  index: number;
  /** Identity of (loadGen, lmId, graphId, channel, index); the candidate choice resets when it changes. */
  nodeKey: string;
}) {
  const viewer = useViewer();
  const overlayChild = useViewerStore((s) => s.overlayChild);
  const setOverlayChild = useViewerStore((s) => s.setOverlayChild);

  // Inspector-local candidate choice for ambiguous ids; never persisted, reset on node change.
  const [choice, setChoice] = useState<{ key: string; graphId: string } | null>(null);
  const childChoice = choice && choice.key === nodeKey ? choice.graphId : null;

  const idVals = featureValues(c, i, 'object_id');
  const rawId = idVals ? idVals[0] : undefined;
  const res = useMemo(
    () => (rawId === undefined ? undefined : resolveObjectId(model, c.channel, rawId)),
    [model, c.channel, rawId],
  );
  const s = res && res.status !== 'unresolved' ? res.lmId : sourceLm(c.channel);

  const childGraphId =
    res?.status === 'resolved' ? res.graphId : res?.status === 'ambiguous' ? childChoice : null;
  const encoding: ObjectIdEncoding | undefined =
    res?.status === 'resolved'
      ? res.encoding
      : res?.status === 'ambiguous'
        ? res.candidates.find((k) => k.graphId === childChoice)?.encoding
        : undefined;
  const child =
    childGraphId !== null && s !== undefined ? model.lms[s]?.graphs.get(childGraphId) : undefined;
  const pose = useMemo(() => lmNodePose(c, i), [c, i]);
  const hasPoints = useMemo(() => (child ? childHasPoints(child) : false), [child]);
  const canOverlay = !!child && !!pose && hasPoints;
  const approximate = !pose?.locationRelModel;
  const look = useChildLook(model, child);
  const theme = useThemeColors();
  // The ring shows where this node sits on the child: needs a drawn child and l.
  const anchor = child && hasPoints ? pose?.locationRelModel : undefined;
  const [hoverAnchor, setHoverAnchor] = useState(false);

  // Never leave the overlay on while there is no (unambiguous) child to show.
  useEffect(() => {
    if (overlayChild && !canOverlay) setOverlayChild(false);
  }, [overlayChild, canOverlay, setOverlayChild]);

  // Viewport child overlay: posed child cloud in overlayGroup (child of modelFrameGroup).
  // `look` changes one frame after a theme change (useThemeColors), so --viewport is current.
  useEffect(() => {
    if (!viewer || !overlayChild || !child || !pose || !look) return;
    const obj = buildChildObject(child, look, cssToRgb(readToken('--viewport')));
    if (!obj) return;
    placeChildCloud(obj, pose, child.centroid);
    viewer.overlayGroup.add(obj);
    return () => disposeObject(obj);
  }, [viewer, overlayChild, child, pose, look]);

  const row9 = useMemo(() => {
    const v = featureValues(c, i, 'pose_vectors');
    return v && v.length >= 9 ? Array.from(v.subarray(0, 9)) : undefined;
  }, [c, i]);
  const content = useMemo<GlyphContent | null>(
    () =>
      row9
        ? { kind: 'lm', row9, child: child && look ? { graph: child, look } : null, anchor }
        : null,
    [row9, child, look, anchor],
  );

  // Hint shown when overlay / open are unavailable.
  let disabledHint: string | null = null;
  if (!res) disabledHint = 'This channel has no object_id';
  else if (res.status === 'unresolved')
    disabledHint = `object_id ${res.id} not found in LM ${s ?? '?'}`;
  else if (res.status === 'ambiguous' && childChoice === null) disabledHint = AMBIGUOUS_HINT;
  else if (!child) disabledHint = 'Child graph not found';
  const overlayHint =
    disabledHint ??
    (!pose ? 'Node has no usable pose' : !hasPoints ? 'child graph has no points' : null);
  const tab = useInspectorTab(!!child);

  const rows: RowSpec[] = [];
  const all = Object.keys(c.features);
  const order = [
    ...LM_ORDER.filter((k) => all.includes(k)),
    ...all.filter((k) => !LM_ORDER.includes(k)),
  ];
  for (const f of order) {
    if (f === 'object_id' && res) {
      rows.push({
        key: f,
        label: <ColorTargetName feature={f} />,
        value: (
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className="shrink-0">
                {res.status === 'unresolved' ? fmt(res.id, 0) : String(Math.round(rawId!))}
              </span>
              {res.status !== 'unresolved' && (
                <>
                  <span className="shrink-0 text-faint">→</span>
                  <DisplayName value={objectIdLabel(res)} />
                </>
              )}
            </div>
            {res.status === 'ambiguous' && (
              <label className="mt-1 flex flex-col gap-0.5 font-sans text-[11px] text-muted">
                Choose child graph
                <select
                  className="rounded border border-border bg-panel px-1 py-0.5 font-mono text-[11px] text-text"
                  value={childChoice ?? ''}
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    setChoice(v ? { key: nodeKey, graphId: v } : null);
                  }}
                >
                  <option value="">— choose —</option>
                  {res.candidates.map((k) => (
                    <option key={k.graphId} value={k.graphId}>
                      {displayName(k.graphId).text} ({k.encoding})
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        ),
        sub: res.status === 'ambiguous' ? 'ambiguous id' : undefined,
      });
    } else if (f === 'pose_vectors' && row9 && featureValues(c, i, f)!.length === 9) {
      rows.push({
        key: f,
        label: (
          <span>
            pose_vectors
            <OrthoWarning row9={row9} />
          </span>
        ),
        sub: 'rows = child x, y, z in parent frame',
        value: <PoseMatrix row9={row9} />,
      });
    } else if (f === 'location_rel_model') {
      const v = featureValues(c, i, f)!;
      rows.push(
        anchor
          ? {
              key: f,
              label: <span>location_rel_model</span>,
              sub: (
                <span className="inline-flex items-center gap-1">
                  child frame ·{' '}
                  <span className="inline-block h-2 w-2 rounded-full border border-select" />
                  in preview
                </span>
              ),
              value: (
                <span className="inline-flex items-center gap-1.5 text-select">
                  <AnchorRing />
                  {fmtVec(v)}
                </span>
              ),
              onHover: setHoverAnchor,
            }
          : {
              key: f,
              label: <span>location_rel_model</span>,
              sub: 'child frame',
              value: fmtVec(v),
            },
      );
    } else {
      const r = genericRow(c, i, f);
      if (r) rows.push(r);
    }
  }

  const childName = childGraphId ?? (res?.status === 'ambiguous' ? null : undefined);

  return (
    <div className="flex flex-col gap-3">
      <div>
        <GlyphView
          content={content}
          caption={
            child ? (
              <span className="inline-flex min-w-0 items-center gap-1">
                <DisplayName value={child.graphId} max={40} /> posed in parent frame
              </span>
            ) : (
              'child axes in parent frame'
            )
          }
          anchorLabel={anchor ? `#${i}` : undefined}
          pulse={hoverAnchor && tab === 'features'}
          footer={look && <ChildLegendStrip legend={look.coloring.legend} dim={theme.dim} />}
        />
        <div className="mt-1.5 flex gap-4 font-mono text-[11px] text-muted">
          {(['x', 'y', 'z'] as const).map((a) => (
            <span key={a} className="inline-flex items-center gap-1">
              <span
                className="inline-block h-0.5 w-3"
                style={{ backgroundColor: `var(--axis-${a})` }}
              />
              child {a}
            </span>
          ))}
          {anchor && (
            <span className="inline-flex items-center gap-1">
              <AnchorRing />
              this node
            </span>
          )}
        </div>
      </div>

      <section>
        <InspectorTabStrip
          tab={tab}
          disabledTitle={child ? null : (disabledHint ?? 'No child object')}
        />
        <InspectorTabPanel tab={tab}>
          {tab === 'features' || !child || !look ? (
            <Table rows={rows} />
          ) : (
            <ChildStylePanel tab={tab} child={child} look={look} />
          )}
        </InspectorTabPanel>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={!canOverlay}
          aria-pressed={overlayChild}
          title={
            overlayHint ??
            (overlayChild ? 'Hide the child overlay' : 'Draw the posed child cloud at this node')
          }
          onClick={() => setOverlayChild(!overlayChild)}
          className={`rounded-lg border px-3 py-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${
            overlayChild
              ? 'border-ch-lm bg-ch-lm-bg text-ch-lm'
              : 'border-border bg-panel text-text hover:bg-row-alt'
          }`}
        >
          <span className="block text-[12px] font-medium">
            Overlay child in viewport {overlayChild && <span aria-hidden="true">✓</span>}
          </span>
          <span className="block text-[11px] text-muted">
            {overlayChild ? (approximate ? 'approximate placement' : 'shown in viewport') : 'off'}
          </span>
        </button>
        <button
          type="button"
          disabled={!child || s === undefined}
          title={disabledHint ?? undefined}
          onClick={() => {
            // Pushes a history entry so the browser Back button returns to the parent graph.
            if (child && s !== undefined) navigateToGraph(s, child.graphId);
          }}
          className="min-w-0 rounded-lg border border-border bg-panel px-3 py-2 text-left text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="block text-[12px] font-medium">Open in LM {s ?? '?'} →</span>
          <span className="block min-w-0 truncate text-[11px] text-muted">
            {childName ? <DisplayName value={childName} max={40} /> : 'child graph'}
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-0.5 text-[11px] text-faint">
        {disabledHint && <p>{disabledHint}</p>}
        {encoding && <p>object_id matched via {ENCODING_NOTE[encoding]}</p>}
        {canOverlay && approximate && <p>approximate placement (no location_rel_model)</p>}
      </div>
    </div>
  );
}
