import { describe, expect, it } from 'vitest';
import { FALLBACK_ERROR_TITLE, friendlyError } from './errorMessages';

describe('friendlyError', () => {
  it.each([
    ['Not a zip file', 'This is not a PyTorch model.pt file (no zip archive found).'],
    [
      'Compressed zip entries are not supported',
      'This file was saved with zip compression, which the viewer does not support. Save it with torch.save (uncompressed).',
    ],
    [
      'Unknown pickle opcode 0xff at byte 2',
      'This file uses a pickle feature the viewer does not understand.',
    ],
    ['Truncated pickle at byte 4', 'The file appears to be truncated or corrupted.'],
    ['Truncated zip central directory', 'The file appears to be truncated or corrupted.'],
    ['Unterminated GLOBAL at byte 2', 'The file appears to be truncated or corrupted.'],
    [
      'Not a Monty model: lm_dict',
      'This is a PyTorch file, but not a Monty model (no lm_dict / graph_memory).',
    ],
    [
      'Unexpected error while reading the model: boom',
      'The viewer hit an unexpected error while reading this file.',
    ],
  ])('%s', (message, title) => {
    expect(friendlyError(message)).toEqual({ title, detail: message });
  });

  it('falls back to the generic title and keeps the raw detail', () => {
    const raw = 'Invalid model data from loader: lms[0]‮<b>x</b>';
    expect(friendlyError(raw)).toEqual({ title: FALLBACK_ERROR_TITLE, detail: raw });
    expect(friendlyError('')).toEqual({ title: FALLBACK_ERROR_TITLE, detail: '' });
  });

  it('matches prefixes only, not substrings', () => {
    expect(friendlyError('Bad arguments; Not a zip file').title).toBe(FALLBACK_ERROR_TITLE);
  });
});
