import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { requestCloseFile } from '../../state/closeRequest';
import { editFailed } from '../../state/editUi';
import {
  acceptsGraphDrag,
  getGraphDrag,
  readGraphDrop,
  type GraphDragPayload,
} from '../../state/graphDrag';
import { MEMORY_WARN_BYTES, loadedBytes } from '../../state/memory';
import { FILE_NAME_MAX, unsavedCount, useViewerStore, type OpenFile } from '../../state/store';
import { formatBytes } from '../../util/bytes';
import { DisplayName } from '../../util/DisplayName';
import { CopyToMenu, runCopy } from './CopyToMenu';
import { LoadingProgress } from './DropZone';
import { LoadError } from './LoadError';

function FileIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

/**
 * Inline name field of a file row. The name exists only in the app (the file on disk keeps its
 * name); `Enter` or leaving the field saves, `Escape` cancels.
 */
function FileNameField({ file, onDone }: { file: OpenFile; onDone(): void }) {
  const renameFile = useViewerStore((s) => s.renameFile);
  const [value, setValue] = useState(file.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const settled = useRef(false);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);
  const finish = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (save) renameFile(file.id, value);
    onDone();
  };
  return (
    <input
      ref={inputRef}
      value={value}
      maxLength={FILE_NAME_MAX}
      spellCheck={false}
      aria-label={`Rename ${file.name}`}
      onChange={(e) => setValue(e.currentTarget.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      className="-mx-1 h-6 min-w-0 flex-1 rounded border border-accent bg-panel px-1 font-mono text-[12px] text-text outline-none"
    />
  );
}

const graphCount = (f: OpenFile) =>
  f.view.lms.reduce((n, lm) => n + lm.graphIds.length + lm.unreadable.length, 0);

function FileRow({ file, active }: { file: OpenFile; active: boolean }) {
  const activateFile = useViewerStore((s) => s.activateFile);
  const [dropOver, setDropOver] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);
  /** Closes the name field and puts focus back on the row (the field is gone). */
  const endRename = () => {
    setRenaming(false);
    rowRef.current?.focus();
  };
  // Drop whose LM index this file lacks: the "Copy to…" chooser restricted to this file.
  const [chooser, setChooser] = useState<{ payload: GraphDragPayload; anchor: HTMLElement } | null>(
    null,
  );

  /** A graph drag of this tab that started in another file (Phase 3b "Drag and drop"). */
  const canDrop = (e: DragEvent) => {
    if (!acceptsGraphDrag(e)) return false;
    const p = getGraphDrag();
    return p !== null && p.fileId !== file.id;
  };
  const onDragOver = (e: DragEvent) => {
    if (!canDrop(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropOver) setDropOver(true);
  };
  const onDrop = (e: DragEvent) => {
    setDropOver(false);
    if (!acceptsGraphDrag(e)) return;
    e.preventDefault();
    const payload = readGraphDrop(e);
    if (payload === null || payload.fileId === file.id) return;
    // Read the target's LMs now (the row's props may be a render behind).
    const target = useViewerStore.getState().files.find((f) => f.id === file.id);
    if (!target) return;
    if (payload.lmId < target.view.lms.length) {
      runCopy(payload, { fileId: file.id, lmId: payload.lmId }).catch(editFailed);
    } else {
      setChooser({ payload, anchor: e.currentTarget as HTMLElement });
    }
  };
  const dirty = unsavedCount(file);
  const count = graphCount(file);
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      activateFile(file.id);
    } else if (e.key === 'F2') {
      e.preventDefault();
      setRenaming(true);
    }
  };
  return (
    <>
      <li
        ref={rowRef}
        role="option"
        aria-selected={active}
        tabIndex={0}
        onClick={() => activateFile(file.id)}
        onKeyDown={onKeyDown}
        onDragEnter={onDragOver}
        onDragOver={onDragOver}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false);
        }}
        onDrop={onDrop}
        className={`group flex h-[34px] cursor-pointer items-center gap-2 rounded-[6px] border px-2.5 outline-none focus-visible:ring-2 focus-visible:ring-accent ${
          active ? 'border-accent bg-accent-bg' : 'border-border bg-bg hover:bg-row-alt'
        } ${dropOver ? 'ring-2 ring-diff-only-b' : ''}`}
      >
        <span className={`shrink-0 ${active ? 'text-accent' : 'text-muted'}`}>
          <FileIcon />
        </span>
        {renaming ? (
          <FileNameField file={file} onDone={endRename} />
        ) : (
          <span
            className="flex min-w-0"
            title="Double-click to rename (in the app only)"
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            <DisplayName
              value={file.name}
              max={FILE_NAME_MAX}
              className={`font-mono text-[12px] ${active ? 'font-semibold text-accent' : 'text-text'}`}
            />
          </span>
        )}
        {dirty > 0 && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-diff-changed"
            title={`${dirty} unsaved ${dirty === 1 ? 'edit' : 'edits'}`}
            aria-label={`${dirty} unsaved ${dirty === 1 ? 'edit' : 'edits'}`}
          />
        )}
        {!renaming && <span className="flex-1" aria-hidden="true" />}
        <span
          className={`shrink-0 text-[11px] text-faint ${renaming ? '' : 'group-focus-within:hidden group-hover:hidden'}`}
          title={`${count} graphs`}
        >
          {count.toLocaleString('en-US')}
        </span>
        {!renaming && (
          <button
            type="button"
            aria-label={`Rename ${file.name}`}
            title="Rename (in the app only) · F2"
            onClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
            className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-muted group-focus-within:flex group-hover:flex hover:bg-border hover:text-text [@media(hover:none)]:flex"
          >
            <PencilIcon />
          </button>
        )}
        <button
          type="button"
          aria-label={`Close ${file.name}`}
          title="Close file"
          onClick={(e) => {
            e.stopPropagation();
            requestCloseFile(file.id);
          }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-border hover:text-text"
        >
          <span aria-hidden="true">×</span>
        </button>
      </li>
      {/* Outside the row: events from the portalled menu must not bubble into the row's click. */}
      {chooser && (
        <CopyToMenu
          source={chooser.payload}
          anchor={chooser.anchor}
          onlyFile={file.id}
          onClose={() => setChooser(null)}
        />
      )}
    </>
  );
}

function MemoryWarning() {
  const files = useViewerStore((s) => s.files);
  const bytes = useMemo(() => loadedBytes(files), [files]);
  if (bytes <= MEMORY_WARN_BYTES) return null;
  const n = files.length;
  return (
    <p
      role="status"
      className="mt-2 rounded-md border border-diff-changed bg-diff-changed-bg px-2.5 py-1.5 text-[11px] text-text"
    >
      {n} {n === 1 ? 'file holds' : 'files hold'} {formatBytes(bytes)} of graph data. Close files
      you no longer need.
    </p>
  );
}

/**
 * The sidebar "Open files" list (spec multi-file-edit-diff Phase 1 "Components"): one row per
 * open file (name, unsaved dot, graph count, rename, close), the "+ Open another model.pt" row that
 * opens the shared file picker, load progress / errors and the memory warning.
 */
export function OpenFilesList({ onOpenModel }: { onOpenModel?: () => void }) {
  const files = useViewerStore((s) => s.files);
  const activeFileId = useViewerStore((s) => s.activeFileId);
  const busy = useViewerStore((s) => s.loading !== undefined);
  return (
    <div>
      <ul role="listbox" aria-label="Open files" className="flex flex-col gap-1.5">
        {files.map((f) => (
          <FileRow key={f.id} file={f} active={f.id === activeFileId} />
        ))}
      </ul>
      <button
        type="button"
        onClick={onOpenModel}
        disabled={!onOpenModel}
        className="mt-1.5 flex h-7 w-full items-center gap-2 rounded-[6px] border border-border bg-panel px-2.5 text-[12px] text-muted hover:bg-row-alt hover:text-text disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span aria-hidden="true" className="text-[14px] leading-none">
          +
        </span>
        <span className="truncate">
          Open another <span className="font-mono">model.pt</span> (or drop it)
        </span>
      </button>
      {busy && <LoadingProgress />}
      <LoadError />
      <MemoryWarning />
    </div>
  );
}
