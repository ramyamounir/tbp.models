import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

function FileIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** File name, size and LM / graph counts of the loaded model. */
export function ModelSummary() {
  const model = useViewerStore((s) => s.model);
  if (!model) return null;
  const graphs = model.lms.reduce((s, lm) => s + lm.graphIds.length, 0);
  const unreadable = model.lms.reduce((s, lm) => s + lm.unreadable.length, 0);
  const nLms = model.lms.length;
  return (
    <div>
      <div className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-bg px-3 py-2.5">
        <span className="shrink-0 text-muted">
          <FileIcon />
        </span>
        <div className="flex min-w-0 flex-col">
          <DisplayName
            value={model.fileName}
            max={64}
            className="font-mono text-[13px] text-text"
          />
          <span className="text-[11px] text-muted">
            {graphs.toLocaleString('en-US')} {graphs === 1 ? 'graph' : 'graphs'}
            {unreadable > 0 && ` · ${unreadable} unreadable`}
          </span>
        </div>
      </div>
      <p className="mt-2 text-[11px] text-faint">
        Read locally in the browser · {nLms} {nLms === 1 ? 'LM' : 'LMs'} ·{' '}
        {formatBytes(model.byteLength)}
      </p>
    </div>
  );
}
