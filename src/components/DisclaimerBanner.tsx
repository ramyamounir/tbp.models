import { useState } from 'react';

/** Independence / liability notice under the top bar. Dismissal is per page load (not persisted). */
export function DisclaimerBanner() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div
      role="note"
      className="flex shrink-0 items-start gap-3 border-b border-border bg-accent-bg px-3 py-2 text-[12.5px] leading-snug text-text sm:items-center sm:px-4"
    >
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Independent community tool.</span> This viewer is not
        affiliated with or endorsed by the Thousand Brains Project. It is provided as-is, without
        warranty, and the Thousand Brains Project assumes no liability for its use. Please use it at
        your own discretion and risk.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        title="Dismiss"
        aria-label="Dismiss notice"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-text"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}
