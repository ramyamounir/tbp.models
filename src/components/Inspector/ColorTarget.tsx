import type { ReactNode } from 'react';
import { useViewerStore, type ColorMode } from '../../state/store';
import { colorModeForFeature } from '../../viewer/colors';

function isCurrent(mode: ColorMode, target: ColorMode | null): boolean {
  if (!target || mode.kind !== target.kind) return false;
  if (mode.kind === 'sm' && target.kind === 'sm') return mode.feature === target.feature;
  if (mode.kind === 'scalar' && target.kind === 'scalar') {
    return mode.feature === target.feature && mode.component === target.component;
  }
  return mode.kind === 'lm';
}

/** A feature name / value that switches the cloud coloring (or plain text when not clickable). */
export function ColorTarget({
  name,
  component,
  title,
  children,
  className,
}: {
  name: string;
  component: number | undefined;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  const colorMode = useViewerStore((s) => s.colorMode);
  const setColorMode = useViewerStore((s) => s.setColorMode);
  const target = colorModeForFeature(name, component);
  if (!target) return <span className={`min-w-0 ${className ?? ''}`}>{children}</span>;
  const current = isCurrent(colorMode, target);
  return (
    <button
      type="button"
      title={title ?? 'Color the cloud by this feature'}
      aria-pressed={current}
      onClick={() => setColorMode(target)}
      className={`inline-flex min-w-0 cursor-pointer items-center gap-1 text-left hover:underline ${
        current ? 'font-semibold' : ''
      } ${className ?? ''}`}
    >
      {children}
      {current && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
          title="coloring"
          aria-label="coloring"
        />
      )}
    </button>
  );
}

export function Swatch({ css }: { css: string }) {
  return (
    <span
      className="ml-2 inline-block h-3 w-3 shrink-0 rounded-sm border border-border align-middle"
      style={{ backgroundColor: css }}
      aria-hidden="true"
    />
  );
}
