/**
 * Point coloring for the five "Color points by" modes (spec Phase 3 "Color modes"). Pure
 * functions (no scene, no store); theme colors are passed in as `ThemeColors`, read from the
 * design tokens with `readThemeColors()`.
 *
 * All colors here are display (sRGB) values in 0..1; the point shader writes them unchanged.
 */
import * as THREE from 'three';
import type { ColorMode, LegendPrefs, LegendPrefsByKind } from '../state/store';
import { resolveObjectId } from '../model/hash';
import type { ChannelGraph, ModelFile, ObjectGraph, ObjectIdResolution } from '../model/types';
import { readToken } from '../theme/readToken';
import { sanitizeDisplay } from '../util/displayName';

export type RGB = [number, number, number];

export interface ThemeColors {
  pointDefault: RGB; // --point-default ("All" mode)
  dim: RGB; // --faint (nodes lacking the colored feature)
  sm: RGB; // --sm (channel source, patch_*)
  lm: RGB; // --lm (channel source, learning_module_*)
}

const tmpColor = new THREE.Color();

/** Parse a CSS color (token value) into sRGB 0..1. Falls back to mid-grey on garbage. */
export function cssToRgb(css: string): RGB {
  try {
    tmpColor.setStyle(css || 'grey', THREE.SRGBColorSpace);
  } catch {
    tmpColor.setRGB(0.5, 0.5, 0.5, THREE.SRGBColorSpace);
  }
  const out = { r: 0, g: 0, b: 0 };
  tmpColor.getRGB(out, THREE.SRGBColorSpace);
  return [out.r, out.g, out.b];
}

export function rgbToCss([r, g, b]: RGB): string {
  const c = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255);
  return `rgb(${c(r)}, ${c(g)}, ${c(b)})`;
}

/** Read the theme tokens used by point coloring (call again after a `resolvedTheme` change). */
export function readThemeColors(): ThemeColors {
  return {
    pointDefault: cssToRgb(readToken('--point-default')),
    dim: cssToRgb(readToken('--faint')),
    sm: cssToRgb(readToken('--sm')),
    lm: cssToRgb(readToken('--lm')),
  };
}

/** Categorical palette for `object_id` (spec; app constant, not a theme token). */
export const CATEGORICAL_CSS = [
  '#0EA5E9',
  '#DB2777',
  '#F59E0B',
  '#10B981',
  '#8B5CF6',
  '#EF4444',
  '#14B8A6',
  '#F97316',
  '#6366F1',
  '#84CC16',
] as const;
const CATEGORICAL: RGB[] = CATEGORICAL_CSS.map(cssToRgb);

/**
 * Categorical palette for a child object's `object_id` (inspector preview and child overlay):
 * disjoint from `CATEGORICAL_CSS`, so a child row is never confused with a parent row.
 */
export const CHILD_CATEGORICAL_CSS = [
  '#FACC15',
  '#92400E',
  '#1E3A8A',
  '#F9A8D4',
  '#166534',
  '#C4B5FD',
  '#99F6E4',
  '#7F1D1D',
] as const;
export const CHILD_CATEGORICAL: RGB[] = CHILD_CATEGORICAL_CSS.map(cssToRgb);

/** HSV (all in 0..1) → RGB; not HSL. */
export function hsvToRgb(h: number, s: number, v: number): RGB {
  const hh = (((h % 1) + 1) % 1) * 6;
  const i = Math.floor(hh);
  const f = hh - i;
  const p = v * (1 - s);
  const q = v * (1 - s * f);
  const t = v * (1 - s * (1 - f));
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

/** Viridis as a 256-stop LUT (polynomial fit of matplotlib's viridis), sRGB 0..1. */
export const VIRIDIS_LUT: Float32Array = (() => {
  // prettier-ignore
  const c = [
    [0.2777273272234177, 0.005407344544966578, 0.3340998053353061],
    [0.1050930431085774, 1.404613529898575, 1.384590162594685],
    [-0.3308618287255563, 0.214847559468213, 0.09509516302823659],
    [-4.634230498983486, -5.799100973351585, -19.33244095627987],
    [6.228269936347081, 14.17993336680509, 56.69055260068105],
    [4.776384997670288, -13.74514537774601, -65.35303263337234],
    [-5.435455855934631, 4.645852612178535, 26.3124352495832],
  ];
  const lut = new Float32Array(256 * 3);
  for (let k = 0; k < 256; k++) {
    const t = k / 255;
    for (let ch = 0; ch < 3; ch++) {
      let v = c[6][ch];
      for (let d = 5; d >= 0; d--) v = c[d][ch] + t * v;
      lut[k * 3 + ch] = Math.min(1, Math.max(0, v));
    }
  }
  return lut;
})();

export function viridis(t: number): RGB {
  const k = Math.round(Math.min(1, Math.max(0, t)) * 255) * 3;
  return [VIRIDIS_LUT[k], VIRIDIS_LUT[k + 1], VIRIDIS_LUT[k + 2]];
}

/** CSS `linear-gradient` for the scalar legend bar. */
export function viridisGradientCss(stops = 9): string {
  const parts: string[] = [];
  for (let s = 0; s < stops; s++) {
    const t = s / (stops - 1);
    parts.push(`${rgbToCss(viridis(t))} ${(t * 100).toFixed(1)}%`);
  }
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

/** Mix toward white (t > 0) or black (t < 0). */
function shade([r, g, b]: RGB, t: number): RGB {
  if (t >= 0) return [r + (1 - r) * t, g + (1 - g) * t, b + (1 - b) * t];
  return [r * (1 + t), g * (1 + t), b * (1 + t)];
}
const SHADES = [0, -0.3, 0.35, -0.5, 0.6];

/** Channel-source color: `--sm` / `--lm`, cycling shades for multiple channels of one kind. */
export function channelSourceColors(graph: ObjectGraph, theme: ThemeColors): Map<string, RGB> {
  const out = new Map<string, RGB>();
  let nSm = 0;
  let nLm = 0;
  for (const c of graph.channels) {
    const k = c.kind === 'sm' ? nSm++ : nLm++;
    out.set(c.channel, shade(c.kind === 'sm' ? theme.sm : theme.lm, SHADES[k % SHADES.length]));
  }
  return out;
}

const hasFeature = (c: ChannelGraph, name: string) =>
  Object.prototype.hasOwnProperty.call(c.features, name);

export interface ScalarOption {
  feature: string;
  component: number;
  label: string;
}

/**
 * Every `(feature, component)` pair across all channels (SM and LM), deduplicated; excludes
 * `pose_vectors` and `object_id`. Order: first appearance (channels in graph order, features in
 * insertion order), components ascending. Label `name` for 1-wide, `name[k]` otherwise (max width
 * over channels decides).
 */
export function scalarOptions(graph: ObjectGraph | undefined): ScalarOption[] {
  if (!graph) return [];
  const widths = new Map<string, number>();
  for (const c of graph.channels) {
    for (const [name, [start, end]] of Object.entries(c.features)) {
      if (name === 'pose_vectors' || name === 'object_id') continue;
      widths.set(name, Math.max(widths.get(name) ?? 0, end - start));
    }
  }
  const out: ScalarOption[] = [];
  for (const [feature, w] of widths) {
    for (let k = 0; k < w; k++) {
      out.push({ feature, component: k, label: w === 1 ? feature : `${feature}[${k}]` });
    }
  }
  return out;
}

export function scalarLabel(graph: ObjectGraph | undefined, feature: string, component: number) {
  return (
    scalarOptions(graph).find((o) => o.feature === feature && o.component === component)?.label ??
    `${feature}[${component}]`
  );
}

/** Column of `feature[component]` in channel `c`, or -1 when the channel lacks it. */
function scalarColumn(c: ChannelGraph, feature: string, component: number): number {
  if (!hasFeature(c, feature)) return -1;
  const [start, end] = c.features[feature];
  if (!Number.isInteger(component) || component < 0 || component >= end - start) return -1;
  return start + component;
}

/** Finite min/max of `feature[component]` over every channel that has it. */
export function scalarRange(
  graph: ObjectGraph,
  feature: string,
  component: number,
): { min: number; max: number; channels: string[] } {
  let min = Infinity;
  let max = -Infinity;
  const channels: string[] = [];
  for (const c of graph.channels) {
    const col = scalarColumn(c, feature, component);
    if (col < 0) continue;
    channels.push(c.channel);
    for (let i = 0; i < c.n; i++) {
      const v = c.x[i * c.F + col];
      if (!Number.isFinite(v)) continue;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  return { min, max, channels };
}

/** Feature-name click in the inspector → color mode (null = not clickable). Used by Phase 4. */
export function colorModeForFeature(name: string, component: number | undefined): ColorMode | null {
  if (name === 'hsv' || name === 'rgba') return { kind: 'sm', feature: name };
  if (name === 'object_id') return { kind: 'lm', feature: 'object_id' };
  if (name === 'pose_vectors' || name === 'location_rel_model') return null;
  return { kind: 'scalar', feature: name, component: component ?? 0 };
}

/**
 * Display text for an object_id resolution (legend and inspector): the graph id when resolved,
 * candidate names (each sanitized) joined by `" | "` when ambiguous, the raw number otherwise.
 * Render it through `displayName` / `<DisplayName>` (which also truncates to 128 code points).
 */
export function objectIdLabel(res: ObjectIdResolution): string {
  switch (res.status) {
    case 'resolved':
      return res.graphId;
    case 'ambiguous':
      return res.candidates.map((c) => sanitizeDisplay(c.graphId)).join(' | ');
    case 'unresolved':
      return String(res.id);
  }
}

/** Legend key of the "no LM data (dimmed)" row of the categorical legend. */
export const DIMMED_KEY = '\u0000dimmed';

/**
 * `rows` sorted by the user's legend order: listed keys first, in that order; unlisted rows after
 * them in their natural order.
 */
export function applyLegendOrder<T>(
  rows: readonly T[],
  key: (row: T) => string,
  order: readonly string[],
): T[] {
  const rank = new Map(order.map((k, i) => [k, i]));
  return rows
    .map((row, i) => ({ row, i, r: rank.get(key(row)) ?? Infinity }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.row);
}

export interface CategoricalRow {
  key: string; // `${channel}\u0000${id}` (stable React key and legend-prefs key; never shown)
  /** The raw `object_id` value shared by this row's nodes (shown as `(id)` in the legend). */
  id: number;
  color: RGB;
  count: number;
  channel: string;
  /** Source LM `s` of the channel, shown as `LM s ·` when the graph has > 1 LM channel. */
  lmPrefix?: number;
  resolution: ObjectIdResolution;
  hidden: boolean;
}

export type Legend =
  | {
      kind: 'categorical';
      title: string;
      rows: CategoricalRow[]; // in priority order (first = drawn on top)
      dimmedCount: number;
      dimmedHidden: boolean;
    }
  | {
      kind: 'channel';
      rows: { channel: string; kind: 'sm' | 'lm'; color: RGB; count: number; hidden: boolean }[]; // priority order
    }
  | {
      kind: 'scalar';
      label: string;
      min: number;
      max: number;
      channels: string[];
      noFinite: boolean;
      dimmedCount: number;
    };

export interface ChannelColoring {
  channel: string;
  colors: Float32Array; // n*3 sRGB
  dimmed: Uint8Array; // 1 = dimmed by the color mode (dim color, alpha 0.25, size × 0.7)
  /**
   * Draw priority, ≥ 0: of nodes that overlap on screen at about the same depth, the higher one is
   * drawn on top. Legend rows rank by the user's order (top row highest); dimmed nodes are 0.
   */
  priority: Float32Array;
  hidden: Uint8Array; // 1 = hidden from the legend (not drawn, not pickable)
}

export interface Coloring {
  channels: ChannelColoring[];
  legend: Legend | null;
}

const NO_PREFS: LegendPrefs = { order: [], hidden: [] };

/** Priority 1 for every colored node, 0 for dimmed ones (modes without legend rows). */
function colorOverDimmed(out: ChannelColoring[]) {
  for (const cc of out)
    for (let i = 0; i < cc.priority.length; i++) cc.priority[i] = 1 - cc.dimmed[i];
}

/**
 * Colors every channel of `graph` for `mode`. `prefs` (legend row order and hidden rows) apply to
 * the categorical and channel-source legends; `palette` colors the categorical rows.
 */
export function computeColoring(
  model: ModelFile,
  graph: ObjectGraph,
  mode: ColorMode,
  theme: ThemeColors,
  prefs?: LegendPrefsByKind,
  palette: readonly RGB[] = CATEGORICAL,
): Coloring {
  const out: ChannelColoring[] = graph.channels.map((c) => ({
    channel: c.channel,
    colors: new Float32Array(c.n * 3),
    dimmed: new Uint8Array(c.n),
    priority: new Float32Array(c.n),
    hidden: new Uint8Array(c.n),
  }));
  const put = (cc: ChannelColoring, i: number, rgb: RGB) => {
    cc.colors[i * 3] = rgb[0];
    cc.colors[i * 3 + 1] = rgb[1];
    cc.colors[i * 3 + 2] = rgb[2];
  };
  const dim = (cc: ChannelColoring, i: number) => {
    put(cc, i, theme.dim);
    cc.dimmed[i] = 1;
  };
  let dimmedCount = 0;
  const dimAll = (cc: ChannelColoring, n: number) => {
    for (let i = 0; i < n; i++) dim(cc, i);
    dimmedCount += n;
  };

  switch (mode.kind) {
    case 'all': {
      graph.channels.forEach((c, k) => {
        for (let i = 0; i < c.n; i++) put(out[k], i, theme.pointDefault);
      });
      return { channels: out, legend: null };
    }

    case 'channel': {
      const { order, hidden } = prefs?.channel ?? NO_PREFS;
      const colors = channelSourceColors(graph, theme);
      const ranked = applyLegendOrder(graph.channels, (c) => c.channel, order);
      graph.channels.forEach((c, k) => {
        const rgb = colors.get(c.channel)!;
        const cc = out[k];
        cc.priority.fill(ranked.length - ranked.indexOf(c));
        cc.hidden.fill(hidden.includes(c.channel) ? 1 : 0);
        for (let i = 0; i < c.n; i++) put(cc, i, rgb);
      });
      return {
        channels: out,
        legend: {
          kind: 'channel',
          rows: ranked.map((c) => ({
            channel: c.channel,
            kind: c.kind,
            color: colors.get(c.channel)!,
            count: c.n,
            hidden: hidden.includes(c.channel),
          })),
        },
      };
    }

    case 'sm': {
      graph.channels.forEach((c, k) => {
        const cc = out[k];
        if (c.kind !== 'sm' || !hasFeature(c, mode.feature)) return dimAll(cc, c.n);
        const [start, end] = c.features[mode.feature];
        const width = end - start;
        for (let i = 0; i < c.n; i++) {
          const b = i * c.F + start;
          if (mode.feature === 'hsv') {
            const h = c.x[b];
            const s = width > 1 ? c.x[b + 1] : 1;
            const v = width > 2 ? c.x[b + 2] : 1;
            if (![h, s, v].every(Number.isFinite)) {
              dim(cc, i);
              dimmedCount++;
              continue;
            }
            const cl = (u: number) => Math.min(1, Math.max(0, u));
            put(cc, i, hsvToRgb(cl(h), cl(s), cl(v)));
          } else {
            const r = c.x[b];
            const g = width > 1 ? c.x[b + 1] : r;
            const bl = width > 2 ? c.x[b + 2] : r;
            if (![r, g, bl].every(Number.isFinite)) {
              dim(cc, i);
              dimmedCount++;
              continue;
            }
            const cl = (u: number) => Math.min(1, Math.max(0, u / 255));
            put(cc, i, [cl(r), cl(g), cl(bl)]);
          }
        }
      });
      colorOverDimmed(out);
      return { channels: out, legend: null };
    }

    case 'lm': {
      const { order, hidden } = prefs?.categorical ?? NO_PREFS;
      const rows = new Map<string, CategoricalRow>();
      const nodeRows = graph.channels.map((c) => new Array<CategoricalRow | undefined>(c.n));
      const lmChannels = graph.channels.filter(
        (c) => c.kind === 'lm' && hasFeature(c, 'object_id'),
      );
      const multiLm = lmChannels.length > 1;
      graph.channels.forEach((c, k) => {
        const cc = out[k];
        if (c.kind !== 'lm' || !hasFeature(c, 'object_id')) return dimAll(cc, c.n);
        const col = c.features.object_id[0];
        const m = /^learning_module_(\d+)$/.exec(c.channel);
        const lmPrefix = multiLm && m ? Number(m[1]) : undefined;
        for (let i = 0; i < c.n; i++) {
          const raw = c.x[i * c.F + col];
          if (!Number.isFinite(raw)) {
            dim(cc, i);
            dimmedCount++;
            continue;
          }
          const key = `${c.channel}\u0000${raw}`;
          let row = rows.get(key);
          if (!row) {
            row = {
              key,
              id: raw,
              color: palette[rows.size % palette.length],
              count: 0,
              channel: c.channel,
              lmPrefix,
              resolution: resolveObjectId(model, c.channel, raw),
              hidden: hidden.includes(key),
            };
            rows.set(key, row);
          }
          row.count++;
          nodeRows[k][i] = row;
          put(cc, i, row.color);
        }
      });
      const ranked = applyLegendOrder([...rows.values()], (r) => r.key, order);
      const priority = new Map(ranked.map((r, j) => [r, ranked.length - j]));
      const dimmedHidden = hidden.includes(DIMMED_KEY);
      out.forEach((cc, k) => {
        for (let i = 0; i < cc.priority.length; i++) {
          const row = nodeRows[k][i];
          cc.priority[i] = row ? priority.get(row)! : 0;
          cc.hidden[i] = (row ? row.hidden : dimmedHidden) ? 1 : 0;
        }
      });
      return {
        channels: out,
        legend: {
          kind: 'categorical',
          title: 'LM · object_id',
          rows: ranked,
          dimmedCount,
          dimmedHidden,
        },
      };
    }

    case 'scalar': {
      const { min, max, channels } = scalarRange(graph, mode.feature, mode.component);
      const noFinite = !(min <= max);
      graph.channels.forEach((c, k) => {
        const cc = out[k];
        const col = scalarColumn(c, mode.feature, mode.component);
        if (col < 0 || noFinite) return dimAll(cc, c.n);
        for (let i = 0; i < c.n; i++) {
          const v = c.x[i * c.F + col];
          if (!Number.isFinite(v)) {
            dim(cc, i);
            dimmedCount++;
            continue;
          }
          put(cc, i, viridis(max === min ? 0.5 : (v - min) / (max - min)));
        }
      });
      colorOverDimmed(out);
      return {
        channels: out,
        legend: {
          kind: 'scalar',
          label: scalarLabel(graph, mode.feature, mode.component),
          min,
          max,
          channels,
          noFinite,
          dimmedCount,
        },
      };
    }
  }
}
