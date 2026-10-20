import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEME_KEY, readStoredTheme, resolveTheme, writeStoredTheme } from './themeStorage';

function mapStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

function throwingStorage() {
  return {
    getItem: () => {
      throw new Error('SecurityError');
    },
    setItem: () => {
      throw new Error('QuotaExceededError');
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readStoredTheme / writeStoredTheme', () => {
  it('round-trips the three valid values', () => {
    const s = mapStorage();
    vi.stubGlobal('localStorage', s);
    for (const t of ['light', 'dark', 'system'] as const) {
      writeStoredTheme(t);
      expect(s.map.get(THEME_KEY)).toBe(t);
      expect(readStoredTheme()).toBe(t);
    }
  });

  it.each([null, '', 'Dark', '{"a":1}', 'x'.repeat(10_000)])(
    'falls back to system for invalid stored value %#',
    (v) => {
      const s = mapStorage();
      if (v !== null) s.map.set(THEME_KEY, v);
      vi.stubGlobal('localStorage', s);
      expect(readStoredTheme()).toBe('system');
    },
  );

  it('returns system when getItem throws', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    expect(readStoredTheme()).toBe('system');
  });

  it('does not throw when setItem throws', () => {
    vi.stubGlobal('localStorage', throwingStorage());
    expect(() => writeStoredTheme('dark')).not.toThrow();
  });

  it('returns system when localStorage is unavailable', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(readStoredTheme()).toBe('system');
    expect(() => writeStoredTheme('light')).not.toThrow();
  });
});

describe('resolveTheme', () => {
  it.each([
    ['light', false, 'light'],
    ['light', true, 'light'],
    ['dark', false, 'dark'],
    ['dark', true, 'dark'],
    ['system', false, 'light'],
    ['system', true, 'dark'],
  ] as const)('resolveTheme(%s, %s) = %s', (theme, prefersDark, expected) => {
    expect(resolveTheme(theme, prefersDark)).toBe(expected);
  });
});
