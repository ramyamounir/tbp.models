import { describe, expect, it } from 'vitest';
import { DISPLAY_MAX, displayName, sanitizeDisplay } from './displayName';

const hasLoneSurrogate = (s: string) =>
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

describe('sanitizeDisplay', () => {
  it('strips C0/DEL/C1 control characters', () => {
    expect(sanitizeDisplay('a\u0000b\u001Bc\u0085')).toBe('abc');
    expect(sanitizeDisplay('a\tb\nc\u007Fd')).toBe('abcd');
  });

  it('strips bidi overrides and isolates', () => {
    expect(sanitizeDisplay('x\u202Eevil\u2066y\u2069')).toBe('xevily');
    expect(sanitizeDisplay('\u202Aa\u202Bb\u202Cc\u202Dd\u2067e\u2068')).toBe('abcde');
  });

  it('strips zero-width characters, marks and BOM', () => {
    expect(sanitizeDisplay('\uFEFFa\u200Bb\u200Cc\u200Dd\u200Ee\u200Ff\u061Cg')).toBe('abcdefg');
  });

  it('replaces lone surrogates with U+FFFD and keeps valid pairs', () => {
    expect(sanitizeDisplay('\uD800')).toBe('\uFFFD');
    expect(sanitizeDisplay('a\uDC00b')).toBe('a\uFFFDb');
    expect(sanitizeDisplay('\uD83D\uDE00')).toBe('\uD83D\uDE00');
  });
});

describe('displayName', () => {
  it('passes short names through unchanged', () => {
    expect(displayName('002_cube_tbp_horz')).toEqual({
      text: '002_cube_tbp_horz',
      full: '002_cube_tbp_horz',
      truncated: false,
    });
  });

  it('truncates long names to DISPLAY_MAX code points ending in an ellipsis', () => {
    const raw = 'a'.repeat(300);
    const d = displayName(raw);
    expect(DISPLAY_MAX).toBe(128);
    expect(Array.from(d.text)).toHaveLength(128);
    expect(d.text.endsWith('\u2026')).toBe(true);
    expect(d.truncated).toBe(true);
    expect(d.full).toBe(raw);
  });

  it('counts astral characters as one code point and never splits them', () => {
    const e127 = '\uD83D\uDE00'.repeat(127);
    expect(displayName(e127)).toEqual({
      text: e127,
      full: e127,
      truncated: false,
    });

    const e200 = '\uD83D\uDE00'.repeat(200);
    const d = displayName(e200);
    expect(d.truncated).toBe(true);
    expect(Array.from(d.text)).toHaveLength(128);
    expect(d.text).toBe('\uD83D\uDE00'.repeat(127) + '\u2026');
    expect(hasLoneSurrogate(d.text)).toBe(false);
  });

  it('shows (empty) for empty or fully stripped strings', () => {
    expect(displayName('').text).toBe('(empty)');
    expect(displayName('\u0000\u202E\u200B').text).toBe('(empty)');
    expect(displayName('').full).toBe('(empty)');
  });

  it('sanitizes before measuring and in full', () => {
    const d = displayName('x\u202Eevil');
    expect(d.text).toBe('xevil');
    expect(d.full).toBe('xevil');
  });

  it('honors the max option', () => {
    const raw = 'e'.repeat(600);
    const d = displayName(raw, { max: 512 });
    expect(Array.from(d.text)).toHaveLength(512);
    expect(d.truncated).toBe(true);
    expect(displayName('e'.repeat(512), { max: 512 }).truncated).toBe(false);
  });
});
