import { useRef, type KeyboardEvent, type ReactNode } from 'react';

export interface PanelTab<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
  /** Tooltip (e.g. why the tab is disabled). */
  title?: string;
}

/**
 * Underlined uppercase tab strip used by the sidebar (COLOR / DISPLAY) and the inspector
 * (FEATURES / COLOR / DISPLAY). Arrow keys, Home and End move between enabled tabs. The panels
 * are labelled `${idPrefix}-panel-${id}` / `${idPrefix}-tab-${id}` (see `TabPanel`).
 */
export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
  idPrefix,
}: {
  tabs: PanelTab<T>[];
  value: T;
  onChange(id: T): void;
  ariaLabel: string;
  idPrefix: string;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  const enabled = tabs.filter((t) => !t.disabled);

  function onKeyDown(e: KeyboardEvent) {
    const i = enabled.findIndex((t) => t.id === value);
    let next: PanelTab<T> | undefined;
    if (e.key === 'ArrowRight') next = enabled[(i + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(i - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.id);
    refs.current.get(next.id)?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className="flex gap-5 border-b border-border"
    >
      {tabs.map((t) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              if (el) refs.current.set(t.id, el);
              else refs.current.delete(t.id);
            }}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${t.id}`}
            aria-controls={`${idPrefix}-panel-${t.id}`}
            aria-selected={selected}
            aria-disabled={t.disabled || undefined}
            tabIndex={selected ? 0 : -1}
            title={t.title}
            onClick={() => !t.disabled && onChange(t.id)}
            className={`-mb-px border-b-2 pb-1.5 text-[11px] font-semibold tracking-wide uppercase ${
              selected
                ? 'border-accent text-text'
                : t.disabled
                  ? 'cursor-not-allowed border-transparent text-faint'
                  : 'border-transparent text-muted hover:text-text'
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

/** Panel of tab `id` of the `PanelTabs` strip with `idPrefix`. */
export function TabPanel({
  idPrefix,
  id,
  className,
  children,
}: {
  idPrefix: string;
  id: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${id}`}
      aria-labelledby={`${idPrefix}-tab-${id}`}
      className={className}
    >
      {children}
    </div>
  );
}
