/**
 * Every malformed-input condition found while reading a model.pt throws a ParseError with a
 * user-facing message (spec Phase 2 "Bounds and validation"). Messages may quote file bytes,
 * so UI code renders them only as sanitized text (Phase 1 "File-derived strings").
 */
export class ParseError extends Error {
  override name = 'ParseError';
}

/** Appends ` at byte X` unless the message already carries a byte offset. */
export function withByteOffset(err: unknown, pos: number, fallback: string): ParseError {
  if (err instanceof ParseError) {
    return /at byte \d+/.test(err.message) ? err : new ParseError(`${err.message} at byte ${pos}`);
  }
  return new ParseError(`${fallback} at byte ${pos}`);
}
