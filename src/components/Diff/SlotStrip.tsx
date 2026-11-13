/** Slot badge and close icon shared by the diff view's pane headers, panels and dialogs. */
import type { Slot } from './slotDrop';

const iconProps = {
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

export function CloseIcon({ size = 14 }: { size?: number }) {
  return (
    <svg {...iconProps} width={size} height={size}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** 20 px rounded square with the slot letter in the slot colour. */
export function SlotBadge({ slot, size = 20 }: { slot: Slot; size?: number }) {
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-[5px] text-[11px] font-semibold text-white ${
        slot === 'a' ? 'bg-slot-a' : 'bg-slot-b'
      }`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {slot.toUpperCase()}
    </span>
  );
}
