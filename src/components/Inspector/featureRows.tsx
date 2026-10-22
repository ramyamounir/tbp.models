/**
 * Inspector feature-table rows (spec Phase 4 "Feature table rows"). Non-component helpers that
 * return row specs for `Table`.
 */
import type { ReactNode } from 'react';
import { isEdgeChannel } from '../../model/edges';
import type { ChannelGraph } from '../../model/types';
import { DisplayName } from '../../util/DisplayName';
import { colorModeForFeature, hsvToRgb, rgbToCss } from '../../viewer/colors';
import { featureValues } from './activeNode';
import { ColorTarget, Swatch } from './ColorTarget';
import { fmt, fmtVec } from './format';

export interface RowSpec {
  key: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  /** Pointer enters (true) / leaves (false) the row. */
  onHover?(on: boolean): void;
}

export const name = (n: string) => <DisplayName value={n} max={40} />;

/** Row labels of `pose_vectors`: 2D-edge channels store `[normal, edge_tangent, edge_perp]`. */
export function poseRowLabels(c: ChannelGraph): [string, string, string] {
  return isEdgeChannel(c)
    ? ['normal', 'edge_tangent', 'edge_perp']
    : ['normal', 'curv_dir_1', 'curv_dir_2'];
}

/** Generic row for a feature: 1-wide scalar or a vector with per-component click targets. */
export function genericRow(c: ChannelGraph, i: number, feature: string): RowSpec | null {
  const v = featureValues(c, i, feature);
  if (!v) return null;
  const clickable = colorModeForFeature(feature, 0) !== null;
  const label = (
    <ColorTarget name={feature} component={0}>
      {name(feature)}
    </ColorTarget>
  );
  if (v.length === 1) return { key: feature, label, value: fmt(v[0]) };
  const comps = Array.from(v, (x, k) =>
    clickable ? (
      <ColorTarget key={k} name={feature} component={k} title={`${feature}[${k}]`}>
        {fmt(x)}
      </ColorTarget>
    ) : (
      <span key={k}>{fmt(x)}</span>
    ),
  );
  return {
    key: feature,
    label,
    value: (
      <span className="inline-flex flex-wrap items-center gap-x-1">
        [
        {comps.map((el, k) => (
          <span key={k} className="inline-flex items-center">
            {el}
            {k < comps.length - 1 ? ',' : ''}
          </span>
        ))}
        ]
      </span>
    ),
  };
}

export function colorRow(c: ChannelGraph, i: number, feature: 'hsv' | 'rgba'): RowSpec | null {
  const v = featureValues(c, i, feature);
  if (!v) return null;
  let css: string | null = null;
  if (Array.from(v).every(Number.isFinite)) {
    const cl = (x: number) => Math.min(1, Math.max(0, x));
    if (feature === 'hsv' && v.length >= 3) css = rgbToCss(hsvToRgb(cl(v[0]), cl(v[1]), cl(v[2])));
    if (feature === 'rgba' && v.length >= 3)
      css = rgbToCss([cl(v[0] / 255), cl(v[1] / 255), cl(v[2] / 255)]);
  }
  return {
    key: feature,
    label: (
      <ColorTarget name={feature} component={undefined}>
        {name(feature)}
      </ColorTarget>
    ),
    value: (
      <span className="inline-flex items-center">
        {fmtVec(v)}
        {css && <Swatch css={css} />}
      </span>
    ),
  };
}
