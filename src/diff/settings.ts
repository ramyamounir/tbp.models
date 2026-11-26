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
export type PresetName = 'exact' | 'strict' | 'default' | 'loose';

export interface DiffSettings {
  match: MatchMode;
  alignCentroids: boolean;
  /**
   * 'nearest' mode only: an A node pairs with the closest unpaired B node at most this far away,
   * in % of the bounding radius R of A's channel; 0 pairs only nodes at exactly the same position.
   * Part of node matching, not of the tolerance presets.
   */
  pairingPct: number;
  /**
   * Tolerance of the 'position' property of a pair, in % of R: like any other feature, it only
   * decides whether a paired node counts as changed.
   */
  positionPct: number;
  /**
   * false: node position is left out of the comparison (no 'position' property; pairing still
   * uses `pairingPct`). Not in the spec's type; the settings table has an enable checkbox on
   * every row (requirements "Each property has a checkbox").
   */
  positionEnabled: boolean;
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
  pairingPct: [0, 10],
  positionPct: [0, 10],
  poseVectorsDeg: [0, 45],
  hsv: [0, 0.5],
  feature: [0, 2],
} as const satisfies Record<string, readonly [number, number]>;

/** Exact features: compared with tolerance 0 in every preset. */
export const EXACT_FEATURES = ['pose_fully_defined', 'on_object'] as const;

function presetFeatures(): ReadonlyMap<string, PropertyTolerance> {
  return new Map(EXACT_FEATURES.map((n) => [n, { enabled: true, tol: 0 }]));
}

/** Pairing distance of a new comparison (% of R). */
export const DEFAULT_PAIRING_PCT = 2.0;

function preset(
  name: PresetName,
  positionPct: number,
  poseDeg: number,
  hsv: number,
  other: number,
): DiffSettings {
  return {
    match: 'nearest',
    alignCentroids: false,
    pairingPct: DEFAULT_PAIRING_PCT,
    positionPct,
    positionEnabled: true,
    poseVectorsDeg: { enabled: true, tol: poseDeg },
    hsv: { enabled: true, tol: hsv },
    objectId: { enabled: true },
    features: presetFeatures(),
    defaultFeatureTol: other,
    preset: name,
  };
}

/**
 * Requirements "Diff settings" tolerance table. Each preset has its own `features` map.
 * 'exact' is the bit-identical check: every value compared with tolerance 0 (only NaN equals
 * NaN and -0 equals 0). The pairing distance is not part of a preset: a moved node within it is
 * a changed pair, beyond it only-A / only-B.
 */
export const PRESETS: Record<PresetName, DiffSettings> = {
  exact: preset('exact', 0, 0, 0, 0),
  strict: preset('strict', 0.5, 1, 0.01, 0.01),
  default: preset('default', 2.0, 5, 0.05, 0.1),
  loose: preset('loose', 5.0, 15, 0.15, 0.5),
};

export const DEFAULT_DIFF_SETTINGS: DiffSettings = PRESETS.default;

/**
 * The tolerance fields of `preset` applied to `s`: node matching (mode, centroid alignment and
 * pairing distance) is not part of a preset and is kept (the table's Exact / Strict / Default /
 * Loose control fills the table).
 */
export function applyPreset(s: DiffSettings, name: PresetName): DiffSettings {
  const p = PRESETS[name];
  return {
    ...p,
    match: s.match,
    alignCentroids: s.alignCentroids,
    pairingPct: s.pairingPct,
    features: presetFeatures(),
  };
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

/** Node matching settings: not part of a tolerance preset, so changing one keeps the preset. */
export const MATCHING_FIELDS: ReadonlySet<keyof DiffSettings> = new Set([
  'match',
  'alignCentroids',
  'pairingPct',
]);

/**
 * `prev` patched with `patch` (store `setDiffSettings`): numbers clamped to their slider ranges
 * (an invalid number keeps the previous value). A patch that names `preset` keeps it (applying
 * a preset or "Reset to defaults"); any other tolerance change sets `preset: 'custom'`, a change
 * of node matching (`MATCHING_FIELDS`) keeps the preset. Returns `prev` itself when nothing
 * changed, so the comparison does not re-run.
 */
export function patchDiffSettings(prev: DiffSettings, patch: Partial<DiffSettings>): DiffSettings {
  const next: DiffSettings = {
    match: patch.match === 'nearest' || patch.match === 'index' ? patch.match : prev.match,
    alignCentroids:
      patch.alignCentroids === undefined ? prev.alignCentroids : !!patch.alignCentroids,
    pairingPct: clamp(patch.pairingPct ?? prev.pairingPct, DIFF_RANGES.pairingPct, prev.pairingPct),
    positionPct: clamp(
      patch.positionPct ?? prev.positionPct,
      DIFF_RANGES.positionPct,
      prev.positionPct,
    ),
    positionEnabled:
      patch.positionEnabled === undefined ? prev.positionEnabled : !!patch.positionEnabled,
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
  const differs = (Object.keys(next) as (keyof DiffSettings)[]).filter(
    (k) => k !== 'preset' && !sameField(prev[k], next[k]),
  );
  const changed = differs.length > 0;
  const tolChanged = differs.some((k) => !MATCHING_FIELDS.has(k));
  const named =
    patch.preset === 'exact' ||
    patch.preset === 'strict' ||
    patch.preset === 'default' ||
    patch.preset === 'loose' ||
    patch.preset === 'custom';
  if (named) next.preset = patch.preset!;
  else if (tolChanged) next.preset = 'custom';
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
