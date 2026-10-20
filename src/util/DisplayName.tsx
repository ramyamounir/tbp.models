import { displayName } from './displayName';

/** Renders a file-derived string as sanitized, truncated text with the full value in `title`. */
export function DisplayName({
  value,
  max,
  className,
}: {
  value: string;
  max?: number;
  className?: string;
}) {
  const d = displayName(value, { max });
  return (
    <span className={`bidi-isolate min-w-0 truncate ${className ?? ''}`} title={d.full} dir="auto">
      {d.text}
    </span>
  );
}
