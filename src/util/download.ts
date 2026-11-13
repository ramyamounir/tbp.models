/** Download helpers shared by the screenshot button and the export dialog (spec multi-file-edit-diff Phase 5). */

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

/** Lone (unpaired) UTF-16 surrogates; no `u` flag so single code units are matched. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const MAX_STEM = 200;

/**
 * A file-name stem that is safe on common systems (spec Phase 5 "sanitizeStem"): NFC, no
 * control / format characters or characters Windows forbids, no lone surrogates, no leading or
 * trailing dots and whitespace, Windows device names prefixed with `_`, at most 200 UTF-16 units
 * (never splitting a surrogate pair), `'model'` when nothing is left.
 */
export function sanitizeStem(input: string): string {
  let s = input.normalize('NFC');
  s = s.replace(/[\p{Cc}\p{Cf}/\\:*?"<>|]/gu, '');
  // Equivalent to `toWellFormed()` followed by removing the U+FFFD it produced.
  s = s.replace(LONE_SURROGATE, '');
  s = s.replace(/^[.\s]+|[.\s]+$/gu, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(s)) s = `_${s}`;
  if (s.length > MAX_STEM) {
    const hi = s.charCodeAt(MAX_STEM - 1);
    s = s.slice(0, hi >= 0xd800 && hi <= 0xdbff ? MAX_STEM - 1 : MAX_STEM);
    s = s.replace(/[.\s]+$/u, '');
  }
  return s === '' ? 'model' : s;
}

/** `name` without a trailing `.pt` (case-insensitive). */
export function stripPt(name: string): string {
  return name.replace(/\.pt$/i, '');
}
