import { useRef, useState, type DragEvent } from 'react';
import { openModelFile } from '../../loader/loadController';
import type { LoadStage } from '../../loader/protocol';
import { useViewerStore } from '../../state/store';

const STAGE_LABEL: Record<LoadStage, string> = {
  reading: 'Reading file…',
  parsing: 'Parsing model…',
  building: 'Building graphs…',
};

const LOCAL_NOTE = 'Read locally in the browser — nothing is uploaded';

function LoadingProgress() {
  const loading = useViewerStore((s) => s.loading);
  if (!loading) return null;
  const pct = loading.pct;
  return (
    <div className="mt-3" role="status" aria-live="polite">
      <div className="flex items-center justify-between text-xs text-muted">
        <span>{STAGE_LABEL[loading.stage]}</span>
        {pct !== undefined && <span className="font-mono">{Math.round(pct)}%</span>}
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-border">
        <div
          className={`h-full rounded-full bg-accent ${pct === undefined ? 'w-1/3 animate-pulse' : ''}`}
          style={pct === undefined ? undefined : { width: `${Math.max(4, pct)}%` }}
        />
      </div>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
    </svg>
  );
}

/**
 * File input + drop target. The actual drop handling is document-level (Sidebar), so a file
 * dropped anywhere loads; this zone only shows the drag highlight. `compact` is the
 * "Open another model" form shown above the model summary once a model is loaded.
 */
export function DropZone({ compact = false }: { compact?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const busy = useViewerStore((s) => s.loading !== undefined);

  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    const next = e.relatedTarget;
    if (!(next instanceof Node) || !e.currentTarget.contains(next)) setOver(false);
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".pt"
      className="hidden"
      onChange={(e) => {
        const file = e.currentTarget.files?.[0];
        e.currentTarget.value = ''; // allow re-opening the same file
        if (file) openModelFile(file);
      }}
    />
  );

  return (
    <div>
      <div
        onDragEnter={() => setOver(true)}
        onDragOver={() => setOver(true)}
        onDragLeave={onDragLeave}
        onDrop={() => setOver(false)}
        className={`rounded-lg border border-dashed text-center transition-colors ${
          over ? 'border-accent bg-accent-bg' : 'border-border bg-bg'
        } ${compact ? 'px-3 py-2' : 'px-4 py-6'}`}
      >
        {input}
        {compact ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex w-full items-center justify-center gap-2 text-xs text-muted hover:text-text"
          >
            <UploadIcon />
            <span>Open another model (or drop it here)</span>
          </button>
        ) : (
          <>
            <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full bg-accent-bg text-accent">
              <UploadIcon />
            </div>
            <p className="text-[13px] text-text">
              Drop a <span className="font-mono">model.pt</span> here
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="mt-3 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-panel hover:opacity-90 disabled:opacity-60"
            >
              Choose file…
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-[11px] text-faint">{LOCAL_NOTE}</p>
      <LoadingProgress />
    </div>
  );
}
