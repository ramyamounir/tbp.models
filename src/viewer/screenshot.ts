/** Screenshot download helpers (spec Phase 3 "Screenshot download"). Pure; no store access. */

/** e.g. lmId 1, '002_cube_tbp_horz' -> 'tbp-model-viewer_lm1_002_cube_tbp_horz.png' */
export function screenshotFileName(lmId: number, graphId: string | undefined): string {
  const safe = (graphId ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80) || 'model';
  return `tbp-model-viewer_lm${lmId}_${safe}.png`;
}
