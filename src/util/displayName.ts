/**
 * Display rule for file-derived strings (graph ids, channel/feature names, file names, error
 * messages): sanitize + truncate for rendering only. Data structures keep the raw string.
 * React-free so workers/tests can import it.
 */
export const DISPLAY_MAX = 128;

// All C0 controls (tab/newline included), DEL, C1 controls,
// bidi embeddings/overrides U+202A-U+202E, bidi isolates U+2066-U+2069,
// plus LRM/RLM/ALM (U+200E, U+200F, U+061C), zero-width U+200B-U+200D, U+FEFF.
// Written with \u escapes on purpose: never paste the literal invisible characters here.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const STRIP = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069\u200B-\u200F\u061C\uFEFF]/g;
// Lone surrogates (String.prototype.toWellFormed is ES2024; the tsconfig lib is older).
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const REPLACEMENT_CHAR = '\uFFFD';
const ELLIPSIS = '\u2026';

/** Remove control/bidi/zero-width characters; lone surrogates become U+FFFD. */
export function sanitizeDisplay(raw: string): string {
  return raw.replace(LONE_SURROGATE, REPLACEMENT_CHAR).replace(STRIP, '');
}

export interface Display {
  text: string;
  full: string;
  truncated: boolean;
}

/** Sanitized, length-limited text for rendering. `full` (sanitized, untruncated) goes in `title`. */
export function displayName(raw: string, opts: { max?: number } = {}): Display {
  const max = opts.max ?? DISPLAY_MAX;
  const full = sanitizeDisplay(String(raw));
  const shown = full.length === 0 ? '(empty)' : full;
  const cps = Array.from(shown); // count code points, never split a surrogate pair
  if (cps.length <= max) return { text: shown, full: shown, truncated: false };
  return { text: cps.slice(0, max - 1).join('') + ELLIPSIS, full: shown, truncated: true };
}
