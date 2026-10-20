import type { Theme } from '../state/store';

/** The only key the app ever persists. Nothing else is stored. */
export const THEME_KEY = 'tbp-viewer-theme';
const ALLOWED: readonly Theme[] = ['light', 'dark', 'system'];

export function isTheme(v: unknown): v is Theme {
  return typeof v === 'string' && (ALLOWED as readonly string[]).includes(v);
}

export function readStoredTheme(): Theme {
  try {
    const v = globalThis.localStorage?.getItem(THEME_KEY);
    return isTheme(v) ? v : 'system';
  } catch {
    return 'system'; // private mode / blocked storage / SecurityError
  }
}

export function writeStoredTheme(t: Theme): void {
  try {
    globalThis.localStorage?.setItem(THEME_KEY, t);
  } catch {
    /* ignore: theme just won't persist */
  }
}

export function readSystemPrefersDark(): boolean {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (systemPrefersDark ? 'dark' : 'light') : theme;
}
