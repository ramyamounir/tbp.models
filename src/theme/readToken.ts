/**
 * Read a theme token (CSS custom property from src/theme/tokens.css) for three.js / canvas code.
 * Call again after a `resolvedTheme` change (deferred one requestAnimationFrame) to pick up the new values.
 */
export function readToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
