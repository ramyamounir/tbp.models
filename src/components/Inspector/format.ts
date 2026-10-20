/** Number formatting and pose checks for the inspector (pure). */

/** `0.123` (3 decimals); non-finite values as `NaN` / `Infinity`. */
export function fmt(v: number, digits = 3): string {
  return Number.isFinite(v) ? v.toFixed(digits) : String(v);
}

export function fmtVec(v: ArrayLike<number>, digits = 3): string {
  return `[${Array.from(v, (x) => fmt(x, digits)).join(', ')}]`;
}

/** Max |rows·rowsᵀ − I| of a row-major 3×3. */
export function orthoError(row9: ArrayLike<number>): number {
  let err = 0;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let dot = 0;
      for (let k = 0; k < 3; k++) dot += row9[3 * i + k] * row9[3 * j + k];
      err = Math.max(err, Math.abs(dot - (i === j ? 1 : 0)));
    }
  }
  return Number.isFinite(err) ? err : Infinity;
}
