/**
 * Rejection of `exportFile` (after cancel()) and of `buildManifest` (after its signal aborts).
 * The export dialog treats it as "no error". Kept in its own module so `manifest.ts` (which the
 * worker bundle imports) does not import `client.ts` (which creates the worker); `client.ts`
 * re-exports it.
 */
export class ExportCancelledError extends Error {
  override name = 'ExportCancelledError';
  constructor() {
    super('Export cancelled');
  }
}
