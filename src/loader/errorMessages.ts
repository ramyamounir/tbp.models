/**
 * Friendly, app-authored titles for loader error messages (spec Phase 5 "Friendly error
 * messages"). Pure: no DOM, no store. `detail` is always the raw message; it is sanitized only at
 * render time (`displayName(detail, {max: 512})`).
 */
export interface FriendlyError {
  title: string;
  detail: string;
}

export const FALLBACK_ERROR_TITLE = 'Could not read this model.';

/** First matching prefix wins. */
const RULES: readonly (readonly [prefixes: readonly string[], title: string])[] = [
  [['Not a zip file'], 'This is not a PyTorch model.pt file (no zip archive found).'],
  [
    ['Compressed zip entries are not supported'],
    'This file was saved with zip compression, which the viewer does not support. Save it with torch.save (uncompressed).',
  ],
  [['Unknown pickle opcode'], 'This file uses a pickle feature the viewer does not understand.'],
  [['Truncated', 'Unterminated GLOBAL'], 'The file appears to be truncated or corrupted.'],
  [
    ['Not a Monty model'],
    'This is a PyTorch file, but not a Monty model (no lm_dict / graph_memory).',
  ],
  [
    ['Unexpected error while reading the model'],
    'The viewer hit an unexpected error while reading this file.',
  ],
];

export function friendlyError(message: string): FriendlyError {
  const detail = String(message);
  for (const [prefixes, title] of RULES) {
    if (prefixes.some((p) => detail.startsWith(p))) return { title, detail };
  }
  return { title: FALLBACK_ERROR_TITLE, detail };
}
