/**
 * Diff settings, presets and property keys (spec multi-file-edit-diff Phase 6 "Settings").
 *
 * Feature names are file data and can be any string ('constructor', '__proto__', 'position',
 * 'any', …): every per-feature table is a `Map`, never a plain object, and every property is
 * identified by a `DiffPropertyKey` whose feature form is always 'feature:'-prefixed.
 */

export type MatchMode = 'nearest' | 'index';
export interface PropertyTolerance {
  enabled: boolean;
  tol: number;
}
export type PresetName = 'strict' | 'default' | 'loose';

export interface DiffSettings {
  match: MatchMode;
  alignCentroids: boolean;
  /** % of A's bounding radius R. */
  positionPct: number;
  /**
   * false: node position is left out of the comparison (no 'position' property; in 'nearest'
   * mode pairing still uses `positionPct`). Not in the spec's type; the settings table has an
   * enable checkbox on every row (requirements "Each property has a checkbox").
   */
  positionEnabled: boolean;
  /** Unmatched nodes allowed for an "equal" verdict. */
  countTol: number;
  /** false: unmatched nodes do not affect the verdict (the "node count" row's checkbox). */
  countEnabled: boolean;
  poseVectorsDeg: PropertyTolerance;
  hsv: PropertyTolerance;
  objectId: { enabled: boolean };
  /** Overrides for other feature names, keyed by the raw feature name. Never mutated. */
  features: ReadonlyMap<string, PropertyTolerance>;
  /** Tolerance of other numeric features without an override. */
  defaultFeatureTol: number;
  preset: PresetName | 'custom';
}

/** Slider ranges of the settings table (position matches the inspector's MATCH_RADIUS_MAX). */
export const DIFF_RANGES = {
  positionPct: [0, 10],
  countTol: [0, 1000],
  poseVectorsDeg: [0, 45],
  hsv: [0, 0.5],
  feature: [0, 2],
} as const satisfies Record<string, readonly [number, number]>;

/** Exact features: compared with tolerance 0 in every preset. */
export const EXACT_FEATURES = ['pose_fully_defined', 'on_object'] as const;

function presetFeatures(): ReadonlyMap<string, PropertyTolerance> {
  return new Map(EXACT_FEATURES.map((n) => [n, { enabled: true, tol: 0 }]));
}

function preset(
  name: PresetName,
  positionPct: number,
  poseDeg: number,
  hsv: number,
  other: number,
): DiffSettings {
  return {
    match: 'nearest',
    alignCentroids: true,
    positionPct,
    positionEnabled: true,
    countTol: 0,
    countEnabled: true,
    poseVectorsDeg: { enabled: true, tol: poseDeg },
    hsv: { enabled: true, tol: hsv },
    objectId: { enabled: true },
    features: presetFeatures(),
    defaultFeatureTol: other,
    preset: name,
  };
}

/** Requirements "Diff settings" tolerance table. Each preset has its own `features` map. */
export const PRESETS: Record<PresetName, DiffSettings> = {
  strict: preset('strict', 0.5, 1, 0.01, 0.01),
  default: preset('default', 2.0, 5, 0.05, 0.1),
  loose: preset('loose', 5.0, 15, 0.15, 0.5),
};

export const DEFAULT_DIFF_SETTINGS: DiffSettings = PRESETS.default;

/**
 * The tolerance fields of `preset` applied to `s`: matching mode and centroid alignment are not
 * part of a preset and are kept (the table's Strict / Default / Loose control fills the table).
 */
export function applyPreset(s: DiffSettings, name: PresetName): DiffSettings {
  const p = PRESETS[name];
  return { ...p, match: s.match, alignCentroids: s.alignCentroids, features: presetFeatures() };
}

/** Identifies one compared property; feature keys are prefixed so no feature name can collide. */
export type DiffPropertyKey = 'position' | `feature:${string}`;

export function featureKey(name: string): DiffPropertyKey {
  return `feature:${name}`;
}

/** Name after the 'feature:' prefix; undefined for 'position'. */
export function featureNameOf(key: DiffPropertyKey): string | undefined {
  return key.startsWith('feature:') ? key.slice('feature:'.length) : undefined;
}

/** Tolerance of feature `name` (pose_vectors / hsv / object_id have their own fields). */
export function featureTolerance(s: DiffSettings, name: string): PropertyTolerance {
  if (name === 'pose_vectors') return s.poseVectorsDeg;
  if (name === 'hsv') return s.hsv;
  if (name === 'object_id') return { enabled: s.objectId.enabled, tol: 0 };
  return s.features.get(name) ?? { enabled: true, tol: s.defaultFeatureTol };
}

const clamp = (v: unknown, [lo, hi]: readonly [number, number], fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

function patchTol(
  prev: PropertyTolerance,
  next: PropertyTolerance | undefined,
  range: readonly [number, number],
): PropertyTolerance {
  if (!next) return prev;
  return { enabled: !!next.enabled, tol: clamp(next.tol, range, prev.tol) };
}

/**
 * `prev` patched with `patch` (store `setDiffSettings`): numbers clamped to their slider ranges
 * (an invalid number keeps the previous value). A patch that names `preset` keeps it (applying
 * a preset or "Reset to defaults"); any other change sets `preset: 'custom'`. Returns `prev`
 * itself when nothing changed, so the comparison does not re-run.
 */
export function patchDiffSettings(prev: DiffSettings, patch: Partial<DiffSettings>): DiffSettings {
  const next: DiffSettings = {
    match: patch.match === 'nearest' || patch.match === 'index' ? patch.match : prev.match,
    alignCentroids:
      patch.alignCentroids === undefined ? prev.alignCentroids : !!patch.alignCentroids,
    positionPct: clamp(
      patch.positionPct ?? prev.positionPct,
      DIFF_RANGES.positionPct,
      prev.positionPct,
    ),
    positionEnabled:
      patch.positionEnabled === undefined ? prev.positionEnabled : !!patch.positionEnabled,
    countTol: Math.round(
      clamp(patch.countTol ?? prev.countTol, DIFF_RANGES.countTol, prev.countTol),
    ),
    countEnabled: patch.countEnabled === undefined ? prev.countEnabled : !!patch.countEnabled,
    poseVectorsDeg: patchTol(prev.poseVectorsDeg, patch.poseVectorsDeg, DIFF_RANGES.poseVectorsDeg),
    hsv: patchTol(prev.hsv, patch.hsv, DIFF_RANGES.hsv),
    objectId: patch.objectId ? { enabled: !!patch.objectId.enabled } : prev.objectId,
    features: patch.features ?? prev.features,
    defaultFeatureTol: clamp(
      patch.defaultFeatureTol ?? prev.defaultFeatureTol,
      DIFF_RANGES.feature,
      prev.defaultFeatureTol,
    ),
    preset: prev.preset,
  };
  const changed = (Object.keys(next) as (keyof DiffSettings)[]).some(
    (k) => k !== 'preset' && !sameField(prev[k], next[k]),
  );
  const named =
    patch.preset === 'strict' ||
    patch.preset === 'default' ||
    patch.preset === 'loose' ||
    patch.preset === 'custom';
  if (named) next.preset = patch.preset!;
  else if (changed) next.preset = 'custom';
  if (!changed && next.preset === prev.preset) return prev;
  return next;
}

function sameField(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object' && !(a instanceof Map)) {
    const ka = Object.keys(a);
    return (
      ka.length === Object.keys(b).length &&
      ka.every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k])
    );
  }
  return false;
}
