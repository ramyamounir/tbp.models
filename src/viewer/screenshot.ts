/** Screenshot download helpers (spec Phase 3 "Screenshot download"). Pure; no store access. */

/** e.g. lmId 1, '002_cube_tbp_horz' -> 'tbp-model-viewer_lm1_002_cube_tbp_horz.png' */
export function screenshotFileName(lmId: number, graphId: string | undefined): string {
  const safe = (graphId ?? '').replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 80) || 'model';
  return `tbp-model-viewer_lm${lmId}_${safe}.png`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000); // a synchronous revoke can abort the download
}
