/**
 * Small shared components of the diff panels (spec multi-file-edit-diff Phase 7b): section
 * labels, the SM / LM chip and icons.
 */
import type { ReactNode } from 'react';
import { iconProps } from './diffFormat';

export function SectionLabel({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-[11px] font-semibold tracking-wide text-muted uppercase">{children}</p>
      {right}
    </div>
  );
}

/** SM / LM chip (inspector colours). */
export function KindChip({ kind }: { kind: 'sm' | 'lm' }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-px font-sans text-[10px] font-semibold ${
        kind === 'sm' ? 'bg-ch-sm-bg text-ch-sm' : 'bg-ch-lm-bg text-ch-lm'
      }`}
    >
      {kind === 'sm' ? 'SM' : 'LM'}
    </span>
  );
}

export function GearIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
    </svg>
  );
}

export function ChevronIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg {...iconProps}>
      <path d={dir === 'left' ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6'} />
    </svg>
  );
}

export function ArrowIcon({ dir }: { dir: 'left' | 'right' }) {
  return (
    <svg {...iconProps}>
      <path d={dir === 'left' ? 'M19 12H5M11 6l-6 6 6 6' : 'M5 12h14M13 6l6 6-6 6'} />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...iconProps} width={13} height={13} strokeWidth={2.5}>
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export function WarnIcon() {
  return (
    <svg {...iconProps} width={13} height={13}>
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18h.01" />
    </svg>
  );
}
