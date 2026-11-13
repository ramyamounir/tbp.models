/**
 * Non-component helpers shared by the diff panels (spec multi-file-edit-diff Phase 7b): icon
 * attributes, button classes and the delta formatting of the summary and node diff panels.
 */
import type { PropertyResult } from '../../diff/compare';
import { formatMm } from '../Inspector/activeNode';
import { fmt } from '../Inspector/format';

export const iconProps = {
  width: 14,
  height: 14,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** A delta (or tolerance) in a property's unit: `3.1 % R`, `1.4 mm`, `12.4°`, `0.18`. */
export function formatDelta(v: number, unit: PropertyResult['unit']): string {
  if (!Number.isFinite(v)) return v === Infinity ? '∞' : '—';
  switch (unit) {
    case '%R':
      return `${v.toFixed(1)} % R`;
    case 'm':
      return formatMm(v);
    case '°':
      return `${v.toFixed(1)}°`;
    default:
      return fmt(v, v !== 0 && Math.abs(v) < 0.01 ? 4 : 2);
  }
}

export const btnSecondary =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border bg-panel px-3 text-[12px] whitespace-nowrap text-text hover:bg-row-alt disabled:cursor-not-allowed disabled:opacity-50';
export const btnPrimary =
  'flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-4 text-[12px] font-medium whitespace-nowrap text-panel hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50';
