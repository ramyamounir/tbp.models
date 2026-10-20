import { useEffect, useState } from 'react';
import { useViewerStore } from '../../state/store';
import { readThemeColors, type ThemeColors } from '../../viewer/colors';

/**
 * Point-coloring theme tokens for React code (legend swatches). Re-read one animation frame
 * after a `resolvedTheme` change so `getComputedStyle` sees the new `data-theme` attribute.
 */
export function useThemeColors(): ThemeColors {
  const resolvedTheme = useViewerStore((s) => s.resolvedTheme);
  const [colors, setColors] = useState<ThemeColors>(() => readThemeColors());
  useEffect(() => {
    const id = requestAnimationFrame(() => setColors(readThemeColors()));
    return () => cancelAnimationFrame(id);
  }, [resolvedTheme]);
  return colors;
}
