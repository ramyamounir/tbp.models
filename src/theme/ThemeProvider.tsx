import { useEffect, useLayoutEffect, type ReactNode } from 'react';
import { useViewerStore } from '../state/store';
import { writeStoredTheme } from './themeStorage';

/**
 * Thin effect component: no React state or context of its own. The store owns `theme` /
 * `resolvedTheme`; this component persists the choice, mirrors the OS preference into the
 * store and applies `data-theme` to <html>.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useViewerStore((s) => s.theme);
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const setSystemPrefersDark = useViewerStore((s) => s.setSystemPrefersDark);

  // 1. Persist the user's choice (the only thing the app ever stores).
  useEffect(() => {
    writeStoredTheme(theme);
  }, [theme]);

  // 2. Follow the OS color scheme live.
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    let mq: MediaQueryList;
    try {
      mq = matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    setSystemPrefersDark(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [setSystemPrefersDark]);

  // 3. Apply the resolved theme before paint.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolvedTheme;
    root.style.colorScheme = resolvedTheme;
  }, [resolvedTheme]);

  return <>{children}</>;
}
