/**
 * Expected export failures (spec Phase 4a "Errors"). The export worker (Phase 4b) reports both
 * classes as a plain `{ type: 'error', message }`; anything else is an internal error.
 */
export class ExportError extends Error {
  override name = 'ExportError';
}

/** The exported file, re-read with the viewer's loader, does not match the edited view. */
export class ExportVerifyError extends ExportError {
  override name = 'ExportVerifyError';
}
