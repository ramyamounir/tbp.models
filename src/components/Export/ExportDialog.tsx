import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EditKind, EditRecord } from '../../edit/types';
import { ExportCancelledError, exportFile, type ExportStage } from '../../export/client';
import { buildManifest } from '../../export/manifest';
import type { ModelFile } from '../../model/types';
import { undoAction } from '../../state/editUi';
import { unsavedRecords, useViewerStore, type OpenFile } from '../../state/store';
import { formatBytes } from '../../util/bytes';
import { DisplayName } from '../../util/DisplayName';
import { downloadBlob, sanitizeStem, stripPt } from '../../util/download';
import { Dialog } from '../ui/Dialog';

/**
 * Export dialog of one open file (spec multi-file-edit-diff Phase 5, mockup 04). Builds the
 * manifest on the main thread, runs the export worker, holds the download behind "Download
 * anyway" when the file references unexpected pickle globals, and marks the file saved.
 * Every file-derived string (names, record text, errors, warnings) is rendered as React text.
 */

const STAGE_LABEL: Record<ExportStage, string> = {
  hashing: 'Hashing models…',
  reading: 'Reading files…',
  parsing: 'Parsing…',
  rebuilding: 'Rebuilding…',
  writing: 'Writing…',
  verifying: 'Verifying…',
};

const GLOBALS_INLINE_MAX = 10;
const PATCH_ERROR_PREFIX = 'Cannot rewrite object_id references';

type Phase =
  | { kind: 'idle' }
  /** Waiting for edits queued before the click (whenEditsIdle). */
  | { kind: 'finishing' }
  | { kind: 'running'; stage: ExportStage; pct?: number }
  /** Export done, download held behind "Download anyway". */
  | {
      kind: 'held';
      blob: Blob;
      warnings: string[];
      unexpectedGlobals: string[];
      fileName: string;
      exportedView: ModelFile;
    }
  | { kind: 'done'; size: number; warnings: string[]; fileName: string }
  | { kind: 'error'; message: string; detail?: string };

const graphCount = (v: Pick<ModelFile, 'lms'>) =>
  v.lms.reduce((n, lm) => n + lm.graphIds.length + lm.unreadable.length, 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The view as opened from disk: the `before` of the oldest record in the history. */
function openedView(f: OpenFile): Pick<ModelFile, 'lms'> {
  const first = f.undo[0] ?? f.redo[f.redo.length - 1];
  return first ? first.before : f.view;
}

const KIND_TILE: Record<EditKind, { sign: string; cls: string }> = {
  duplicate: { sign: '+', cls: 'bg-diff-only-b-bg text-diff-only-b' },
  copy: { sign: '+', cls: 'bg-diff-only-b-bg text-diff-only-b' },
  addLm: { sign: '+', cls: 'bg-diff-only-b-bg text-diff-only-b' },
  duplicateLm: { sign: '+', cls: 'bg-diff-only-b-bg text-diff-only-b' },
  rename: { sign: '~', cls: 'bg-diff-changed-bg text-diff-changed' },
  delete: { sign: '−', cls: 'bg-diff-only-a-bg text-diff-only-a' },
  deleteLm: { sign: '−', cls: 'bg-diff-only-a-bg text-diff-only-a' },
};

function UndoIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mt-[2px] shrink-0"
    >
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}

function ChangeRow({
  rec,
  reverted,
  undoable,
  disabledTitle,
}: {
  rec: EditRecord;
  reverted?: boolean;
  /** Only the most recent edit can be undone on its own. */
  undoable?: boolean;
  disabledTitle?: string;
}) {
  const tile = KIND_TILE[rec.kind];
  return (
    <li
      className={`flex items-start gap-3 border-b border-border px-3 py-2 last:border-b-0 ${reverted ? 'opacity-55' : ''}`}
    >
      <span
        className={`mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-md font-mono text-[13px] font-semibold ${tile.cls}`}
        aria-hidden="true"
      >
        {tile.sign}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
          <span className="text-[13px] text-text">
            {reverted ? `Reverted: ${rec.title}` : rec.title}
          </span>
          {rec.detail !== '' && (
            <span className="min-w-0 truncate font-mono text-[12px] text-text" title={rec.detail}>
              {rec.detail}
            </span>
          )}
        </div>
        {rec.note !== undefined && rec.note !== '' && (
          <div className="mt-0.5 truncate text-[11px] text-muted" title={rec.note}>
            {rec.note}
          </div>
        )}
      </div>
      {!reverted && (
        <button
          type="button"
          disabled={!undoable}
          onClick={() => undoAction()}
          title={undoable ? 'Undo this edit' : disabledTitle}
          aria-label={`Undo ${rec.title}`}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-row-alt hover:text-text disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <UndoIcon />
        </button>
      )}
    </li>
  );
}

function SummaryCard({
  label,
  name,
  graphs,
  lms,
  size,
  highlight,
}: {
  label: string;
  name: string;
  graphs: number;
  lms: number;
  size?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`min-w-0 flex-1 rounded-lg border px-3 py-2 ${highlight ? 'border-accent-bg bg-accent-bg' : 'border-border bg-row-alt'}`}
    >
      <div
        className={`text-[11px] font-semibold tracking-wide ${highlight ? 'text-accent' : 'text-muted'}`}
      >
        {label}
      </div>
      <DisplayName
        value={name}
        max={60}
        className="block truncate font-mono text-[13px] text-text"
      />
      <div className="font-mono text-[11px] text-muted">
        {plural(graphs, 'graph')} · {plural(lms, 'LM')} ·{' '}
        {size ?? <span className="font-sans text-faint">size calculated on export</span>}
      </div>
    </div>
  );
}

function GlobalsWarning({ list, onDownload }: { list: string[]; onDownload(): void }) {
  const head = list.slice(0, GLOBALS_INLINE_MAX);
  const more = list.length - head.length;
  return (
    <div
      role="alert"
      className="mt-3 rounded-lg border border-diff-only-a bg-diff-only-a-bg px-3 py-2 text-[12px] text-text"
    >
      <p>
        This file references code outside the usual Monty / numpy / torch set:{' '}
        <span className="font-mono">{head.join(', ')}</span>
        {more > 0 && ` and ${more} more`}. <span className="font-mono">torch.load</span> will run
        it. Download only if you trust every file this one took content from.
      </p>
      {more > 0 && (
        <pre className="mt-2 max-h-32 overflow-auto rounded bg-panel p-2 font-mono text-[11px] whitespace-pre-wrap">
          {list.join('\n')}
        </pre>
      )}
      <button
        type="button"
        onClick={onDownload}
        className="mt-2 h-7 rounded-md border border-border bg-panel px-3 text-[12px] font-medium text-diff-only-a hover:bg-row-alt"
      >
        Download anyway
      </button>
    </div>
  );
}

function Warnings({ list }: { list: string[] }) {
  if (list.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-diff-changed bg-diff-changed-bg px-3 py-2 text-[12px] text-text">
      <ul className="list-disc pl-4">
        {list.map((w, i) => (
          <li key={i}>{w}</li>
        ))}
      </ul>
    </div>
  );
}

function ErrorBox({ message, detail }: { message: string; detail?: string }) {
  return (
    <div
      role="alert"
      className="mt-3 rounded-lg border border-diff-only-a bg-diff-only-a-bg px-3 py-2 text-[12px] text-text"
    >
      <p className="break-words">{message}</p>
      {message.startsWith(PATCH_ERROR_PREFIX) && (
        <p className="mt-1 text-muted">Undo the rename, or redo it without "Update references".</p>
      )}
      {detail !== undefined && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted">Details</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-panel p-2 font-mono text-[11px] whitespace-pre-wrap">
            {detail}
          </pre>
        </details>
      )}
    </div>
  );
}

export function ExportDialog({ fileId, onClose }: { fileId: string; onClose(): void }) {
  const file = useViewerStore((s) => s.files.find((f) => f.id === fileId));
  const [stem, setStem] = useState(() =>
    // A name given in the app is the suggestion as it is; an untouched one gets "_edited".
    sanitizeStem(
      file?.renamed ? stripPt(file.name) : `${stripPt(file?.file.name ?? 'model')}_edited`,
    ),
  );
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** Bumped on every start / cancel / unmount; an export task acts only while its run is current. */
  const runRef = useRef(0);
  const abortRef = useRef<(() => void) | undefined>(undefined);

  const cancelRun = () => {
    runRef.current++;
    const abort = abortRef.current;
    abortRef.current = undefined;
    abort?.();
  };

  useEffect(
    () => () => {
      // Closing the dialog (unmount) cancels a running export.
      runRef.current++;
      abortRef.current?.();
      abortRef.current = undefined;
    },
    [],
  );

  if (!file) return null;

  const frozen = phase.kind === 'finishing' || phase.kind === 'running' || phase.kind === 'held';
  const exporting = phase.kind === 'finishing' || phase.kind === 'running';
  const fileName = `${sanitizeStem(stem)}.pt`;
  const { records, reverted } = unsavedRecords(file);
  const opened = openedView(file);

  const finishDownload = (
    blob: Blob,
    name: string,
    exportedView: ModelFile,
    warnings: string[],
  ) => {
    downloadBlob(blob, name);
    useViewerStore.getState().markExported(fileId, exportedView);
    setPhase({ kind: 'done', size: blob.size, warnings, fileName: name });
  };

  const start = async () => {
    cancelRun();
    const run = runRef.current;
    const name = fileName;
    const current = () => runRef.current === run;
    setPhase({ kind: 'finishing' });
    const store = useViewerStore.getState();
    await store.whenEditsIdle(fileId);
    if (!current()) return;
    const f = useViewerStore.getState().files.find((x) => x.id === fileId);
    if (!f) {
      setPhase({ kind: 'error', message: 'The file was closed.' });
      return;
    }
    const exportedView = f.view;
    const controller = new AbortController();
    abortRef.current = () => controller.abort();
    const onProgress = (p: { stage: ExportStage; pct?: number }) => {
      if (current()) setPhase({ kind: 'running', stage: p.stage, pct: p.pct });
    };
    setPhase({ kind: 'running', stage: 'hashing' });
    try {
      const manifest = await buildManifest(
        f,
        useViewerStore.getState().sourceFiles,
        onProgress,
        controller.signal,
      );
      if (!current() || controller.signal.aborted) throw new ExportCancelledError();
      const job = exportFile(manifest, name, onProgress);
      abortRef.current = job.cancel;
      const res = await job.promise;
      if (!current()) return;
      abortRef.current = undefined;
      if (res.unexpectedGlobals.length > 0) {
        setPhase({
          kind: 'held',
          blob: res.blob,
          warnings: res.warnings,
          unexpectedGlobals: res.unexpectedGlobals,
          fileName: name,
          exportedView,
        });
      } else {
        finishDownload(res.blob, name, exportedView, res.warnings);
      }
    } catch (err) {
      if (!current()) return;
      abortRef.current = undefined;
      if (err instanceof ExportCancelledError) {
        setPhase({ kind: 'idle' });
        return;
      }
      const e = err as { message?: unknown; detail?: unknown };
      const message = typeof e?.message === 'string' ? e.message : String(err);
      const detail = typeof e?.detail === 'string' ? e.detail : undefined;
      if (!(err instanceof Error) || err.name === 'Error') console.error(err);
      setPhase({ kind: 'error', message, detail });
    }
  };

  /** Cancel button: stops a running export (back to idle), else closes. */
  const onCancelButton = () => {
    if (exporting) {
      cancelRun();
      setPhase({ kind: 'idle' });
    } else {
      onClose();
    }
  };
  /** Esc / scrim: cancels a running export and closes. */
  const close = () => {
    cancelRun();
    onClose();
  };

  const savedReachable = file.savedDepth >= 0;
  const undoAllCount = savedReachable ? file.undo.length - file.savedDepth : 0;
  const undoAllDisabled = frozen || !savedReachable || undoAllCount <= 0;
  const exactSize =
    phase.kind === 'held'
      ? formatBytes(phase.blob.size)
      : phase.kind === 'done'
        ? formatBytes(phase.size)
        : undefined;

  let primary: ReactNode;
  if (phase.kind === 'done' || phase.kind === 'held') {
    primary = (
      <button
        type="button"
        onClick={onClose}
        className="h-8 rounded-md bg-accent px-4 text-[13px] font-medium text-panel hover:opacity-90"
      >
        {phase.kind === 'done' ? 'Done' : 'Close'}
      </button>
    );
  } else if (exporting) {
    const label = phase.kind === 'finishing' ? 'Finishing edits…' : STAGE_LABEL[phase.stage];
    const pct = phase.kind === 'running' ? phase.pct : undefined;
    primary = (
      <div
        role="status"
        aria-live="polite"
        className="relative flex h-8 min-w-[160px] items-center justify-center overflow-hidden rounded-md bg-accent px-4 text-[13px] font-medium text-panel"
      >
        <span>{label}</span>
        <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/25" aria-hidden="true">
          {pct !== undefined ? (
            <span
              className="block h-full bg-white transition-[width]"
              style={{ width: `${pct}%` }}
            />
          ) : (
            <span className="block h-full w-1/3 animate-pulse bg-white" />
          )}
        </span>
      </div>
    );
  } else {
    primary = (
      <button
        type="button"
        onClick={() => void start()}
        className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-panel hover:opacity-90"
      >
        <DownloadIcon />
        Download .pt
      </button>
    );
  }

  return (
    <Dialog
      open
      width={560}
      title={
        <>
          Export <DisplayName value={file.name} max={48} />
        </>
      }
      subtitle="Exports the active file with its edits. Each open file is exported separately."
      onCancel={close}
      footer={
        <>
          {phase.kind !== 'done' && phase.kind !== 'held' && (
            <button
              type="button"
              onClick={onCancelButton}
              className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt"
            >
              Cancel
            </button>
          )}
          {primary}
        </>
      }
    >
      <label
        className="block text-[11px] font-semibold tracking-wide text-muted"
        htmlFor={`export-name-${fileId}`}
      >
        FILE NAME
      </label>
      <div className="mt-1 flex h-9 items-center rounded-md border border-border bg-panel px-3 focus-within:border-accent">
        <input
          id={`export-name-${fileId}`}
          data-autofocus
          value={stem}
          disabled={frozen}
          spellCheck={false}
          onChange={(e) => setStem(e.currentTarget.value)}
          onBlur={() => setStem((s) => sanitizeStem(s))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && phase.kind !== 'done') {
              e.preventDefault();
              setStem((s) => sanitizeStem(s));
              void start();
            }
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-text outline-none disabled:opacity-60"
        />
        <span className="font-mono text-[12px] text-faint">.pt</span>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <SummaryCard
          label="OPENED"
          name={file.file.name}
          graphs={graphCount(opened)}
          lms={opened.lms.length}
          size={formatBytes(file.file.size)}
        />
        <span className="shrink-0 text-faint">
          <ArrowIcon />
        </span>
        <SummaryCard
          label="EXPORT"
          name={phase.kind === 'held' || phase.kind === 'done' ? phase.fileName : fileName}
          graphs={graphCount(file.view)}
          lms={file.view.lms.length}
          size={exactSize}
          highlight
        />
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className="text-[11px] font-semibold tracking-wide text-muted">
          CHANGES <span className="ml-1 font-normal">{records.length}</span>
        </span>
        <button
          type="button"
          disabled={undoAllDisabled}
          onClick={() => {
            for (let i = 0; i < undoAllCount; i++) undoAction();
          }}
          title={
            !savedReachable
              ? 'The last exported state is no longer reachable by undo'
              : 'Return to the last exported state'
          }
          className="text-[12px] text-accent hover:underline disabled:cursor-not-allowed disabled:text-faint disabled:no-underline"
        >
          Undo all
        </button>
      </div>
      {!savedReachable && (
        <p className="mt-2 rounded-md bg-diff-changed-bg px-3 py-1.5 text-[12px] text-diff-changed">
          Includes edits made after undoing past the last export
        </p>
      )}
      {records.length === 0 && reverted.length === 0 ? (
        <p className="mt-2 rounded-lg border border-border px-3 py-3 text-[12px] text-muted">
          No edits. The export is a re-written copy of the file.
        </p>
      ) : (
        <ul className="mt-2 max-h-[240px] overflow-y-auto rounded-lg border border-border">
          {records.map((rec, i) => (
            <ChangeRow
              key={`r${i}`}
              rec={rec}
              undoable={!frozen && i === records.length - 1}
              disabledTitle={
                i === records.length - 1
                  ? 'Wait for the export to finish'
                  : 'Undo the later edits first'
              }
            />
          ))}
          {reverted.map((rec, i) => (
            <ChangeRow key={`v${i}`} rec={rec} reverted />
          ))}
        </ul>
      )}

      {phase.kind === 'error' && <ErrorBox message={phase.message} detail={phase.detail} />}
      {phase.kind === 'held' && (
        <GlobalsWarning
          list={phase.unexpectedGlobals}
          onDownload={() =>
            finishDownload(phase.blob, phase.fileName, phase.exportedView, phase.warnings)
          }
        />
      )}
      {(phase.kind === 'held' || phase.kind === 'done') && <Warnings list={phase.warnings} />}
      {phase.kind === 'done' && (
        <p className="mt-3 text-[12px] text-diff-only-b">
          Downloaded <span className="font-mono">{phase.fileName}</span>.
        </p>
      )}

      <p className="mt-4 flex items-start gap-2 text-[11px] text-muted">
        <LockIcon />
        <span>
          Built locally in your browser; nothing is uploaded. The viewer never runs pickle code, but
          an exported file is a pickle that torch.load executes: it is only as trustworthy as every
          file it took content from.
        </span>
      </p>
    </Dialog>
  );
}
