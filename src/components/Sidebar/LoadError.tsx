import { friendlyError } from '../../loader/errorMessages';
import { useViewerStore } from '../../state/store';
import { displayName } from '../../util/displayName';

/**
 * Loader error: a fixed, app-authored friendly title (`friendlyError`) in bold, with the raw
 * message beneath it in JetBrains Mono, sanitized and rendered as text only.
 */
export function LoadError() {
  const error = useViewerStore((s) => s.error);
  if (error === undefined) return null;
  const { title, detail: raw } = friendlyError(error);
  const detail = displayName(raw, { max: 512 });
  return (
    <div role="alert" className="mt-3 rounded-md border border-border bg-bg px-3 py-2">
      <p className="text-[13px] font-semibold text-text">{title}</p>
      <p className="mt-1 font-mono text-[11px] break-words text-muted" title={detail.full}>
        {detail.text}
      </p>
    </div>
  );
}
