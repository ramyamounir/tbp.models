/**
 * "Copy to…" chooser (spec multi-file-edit-diff Phase 3b "Copy to… chooser"). One module owns the
 * target list, the copy itself (children prompt → one `runEdit` on the target file's chain →
 * confirmation toast) and the popover, so every entry point behaves the same: the row menu, the
 * bulk bar, the LM "⋯" menu, a drop on a file row that lacks the LM and (Phase 7b) the diff
 * summary footer.
 *
 * File names and model names are file-derived: rendered only as React text (menu labels, dialog
 * text) or plain toast text.
 */
import { useMemo, useSyncExternalStore } from 'react';
import { copyGraphs, takenIds } from '../../edit/ops';
import { descendantsOf } from '../../edit/references';
import type { GraphAddress } from '../../edit/types';
import type { ObjectGraph } from '../../model/types';
import { editFailed } from '../../state/editUi';
import { useViewerStore, type OpenFile } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { displayName } from '../../util/displayName';
import { Dialog } from '../ui/Dialog';
import { Menu, type MenuAnchor, type MenuItem } from '../ui/Menu';
import { showToast } from '../ui/Toast';

/** Readable ids only, all in source LM `lmId`. */
export interface CopySource {
  fileId: string;
  lmId: number;
  graphIds: string[];
}
export type CopyTarget = { fileId: string; lmId: number | 'new' };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
/** File-derived name for plain toast text (sanitised, truncated). */
const shortName = (s: string) => displayName(s, { max: 48 }).text;

function PlusIcon() {
  return (
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
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function sectionHeader(fileId: string, kind: 'THIS FILE' | 'OTHER FILE', name: string): MenuItem {
  return {
    kind: 'item',
    id: `hdr-${fileId}`,
    disabled: true,
    label: (
      <span className="flex min-w-0 items-center gap-1 text-[10px] font-semibold tracking-wide">
        <span className="shrink-0">{kind} ·</span>
        <DisplayName value={name} max={48} className="font-mono normal-case" />
      </span>
    ),
  };
}

/** Target items for a Menu (sections + LM items + "New LM…"). Pure builder; reads files from the store. */
// eslint-disable-next-line react-refresh/only-export-components -- spec API (Phase 3b)
export function copyTargetItems(source: CopySource, opts?: { onlyFile?: string }): MenuItem[] {
  const files = useViewerStore.getState().files;
  const src = files.find((f) => f.id === source.fileId);
  if (!src || source.graphIds.length === 0) {
    return [{ kind: 'item', id: 'nothing', label: 'Nothing to copy', disabled: true }];
  }
  const ordered: OpenFile[] = [src, ...files.filter((f) => f.id !== src.id)];
  const out: MenuItem[] = [];
  for (const f of ordered) {
    if (opts?.onlyFile !== undefined && f.id !== opts.onlyFile) continue;
    const own = f.id === source.fileId;
    if (out.length > 0) out.push({ kind: 'separator', id: `sep-${f.id}` });
    out.push(sectionHeader(f.id, own ? 'THIS FILE' : 'OTHER FILE', f.name));
    for (const lm of f.view.lms) {
      if (own && lm.lmId === source.lmId) continue;
      const n = lm.graphIds.length + lm.unreadable.length;
      out.push({
        kind: 'item',
        id: `t-${f.id}-${lm.lmId}`,
        label: `LM ${lm.lmId}`,
        title: plural(n, 'graph'),
        shortcut: plural(n, 'graph'),
        onSelect: () => {
          runCopy(source, { fileId: f.id, lmId: lm.lmId }).catch(editFailed);
        },
      });
    }
    out.push({
      kind: 'item',
      id: `t-${f.id}-new`,
      label: 'New LM…',
      icon: <PlusIcon />,
      title: `Copy into a new LM ${f.view.lms.length}`,
      onSelect: () => {
        runCopy(source, { fileId: f.id, lmId: 'new' }).catch(editFailed);
      },
    });
  }
  if (out.length === 0)
    return [{ kind: 'item', id: 'nothing', label: 'Nothing to copy', disabled: true }];
  return out;
}

// ---- copy-children prompt -----------------------------------------------------------------------

type ChildrenChoice = 'with' | 'without' | 'cancel';

interface ChildrenPrompt {
  id: number;
  n: number;
  c: number;
  targetName: string;
  resolve(choice: ChildrenChoice): void;
}

let prompt: ChildrenPrompt | null = null;
let promptSeq = 0;
const promptListeners = new Set<() => void>();
const emitPrompt = () => {
  for (const l of promptListeners) l();
};
const subscribePrompt = (l: () => void) => {
  promptListeners.add(l);
  return () => promptListeners.delete(l);
};

function settlePrompt(id: number, choice: ChildrenChoice): void {
  if (prompt === null || prompt.id !== id) return;
  const p = prompt;
  prompt = null;
  emitPrompt();
  p.resolve(choice);
}

/** Opens the copy-children Dialog; a second call while one is open resolves the first with 'cancel'. */
function askCopyChildren(args: {
  n: number;
  c: number;
  targetName: string;
}): Promise<ChildrenChoice> {
  if (prompt !== null) settlePrompt(prompt.id, 'cancel');
  return new Promise((resolve) => {
    prompt = { id: ++promptSeq, ...args, resolve };
    emitPrompt();
  });
}

/** Imperative host for the copy-children Dialog; mounted once in App.tsx next to <ToastHost />. */
export function CopyChildrenPromptHost() {
  const p = useSyncExternalStore(
    subscribePrompt,
    () => prompt,
    () => null,
  );
  if (!p) return null;
  const cancel = () => settlePrompt(p.id, 'cancel');
  return (
    <Dialog
      open
      width={460}
      title="Copy child models too?"
      subtitle={
        <>
          {p.n === 1 ? '1 of these models references' : `${p.n} of these models reference`}{' '}
          {plural(p.c, 'child model')} that{' '}
          <DisplayName value={p.targetName} max={48} className="font-mono" /> does not have.
        </>
      }
      onCancel={cancel}
      footer={
        <>
          <button
            type="button"
            onClick={cancel}
            className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => settlePrompt(p.id, 'without')}
            className="h-8 rounded-md border border-border bg-panel px-3 text-[13px] text-text hover:bg-row-alt"
          >
            Copy without
          </button>
          <button
            type="button"
            data-autofocus
            onClick={() => settlePrompt(p.id, 'with')}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-panel hover:opacity-90"
          >
            Copy with {p.c} {p.c === 1 ? 'child' : 'children'}
          </button>
        </>
      }
    >
      <p className="text-[12px] text-muted">
        Without them, the copied models’ object_id values do not resolve in the target. Each child
        goes to the LM with its own index, which is created if missing.
      </p>
    </Dialog>
  );
}

// ---- the copy --------------------------------------------------------------------------------

const addrKey = (a: GraphAddress) => `${a.lmId}\u0000${a.graphId}`;

/** Children prompt, then one runEdit on the target file's chain, then the toast. */
// eslint-disable-next-line react-refresh/only-export-components -- spec API (Phase 3b)
export async function runCopy(source: CopySource, target: CopyTarget): Promise<void> {
  // 1. A copy of a model onto its own LM is never made (reachable only from a drop).
  if (target.fileId === source.fileId && target.lmId === source.lmId) return;

  // 2. Children check on the current views.
  const files0 = useViewerStore.getState().files;
  const src0 = files0.find((f) => f.id === source.fileId)?.view;
  if (!src0) {
    showToast({ text: 'Nothing copied: the source file was closed' });
    return;
  }
  const dest0 = files0.find((f) => f.id === target.fileId);
  if (!dest0) {
    showToast({ text: 'Nothing copied: the target file was closed' });
    return;
  }
  const srcLm = src0.lms[source.lmId];
  const selected: ObjectGraph[] = [];
  for (const id of new Set(source.graphIds)) {
    const g = srcLm?.graphs.get(id);
    if (g) selected.push(g);
  }
  const missing = descendantsOf(src0, selected).filter((c) => {
    const lm = dest0.view.lms[c.lmId];
    return !lm || !takenIds(lm).has(c.graphId);
  });

  // 3. Ask about missing children.
  let choice: ChildrenChoice = 'without';
  if (missing.length > 0) {
    const missingKeys = new Set(missing.map(addrKey));
    const n = selected.filter((g) =>
      descendantsOf(src0, [g]).some((d) => missingKeys.has(addrKey(d))),
    ).length;
    choice = await askCopyChildren({ n, c: missing.length, targetName: dest0.name });
    if (choice === 'cancel') return;
  }

  // 4. One runEdit on the target file's chain: one undo record, including a new LM.
  let destLm: number | undefined;
  let selectedCount = 0;
  let addedCount = 0;
  const applied = await useViewerStore
    .getState()
    .runEdit(target.fileId, async (destView, files) => {
      const srcView =
        source.fileId === target.fileId
          ? destView
          : files.find((f) => f.id === source.fileId)?.view;
      if (!srcView) return undefined;
      destLm = target.lmId === 'new' ? destView.lms.length : target.lmId;
      // Target LM deleted by an earlier queued edit: never create an LM from a stale index.
      if (target.lmId !== 'new' && destLm >= destView.lms.length) return undefined;
      const items = source.graphIds.map((graphId) => ({ lmId: source.lmId, graphId }));
      const lm = srcView.lms[source.lmId];
      selectedCount = lm ? new Set(source.graphIds.filter((id) => lm.graphs.has(id))).size : 0;
      const rec = await copyGraphs(destView, destLm, srcView, items, {
        withChildren: choice === 'with',
      });
      addedCount = rec?.added?.length ?? 0;
      return rec;
    });

  // 5. Toast.
  if (!applied || destLm === undefined) {
    showToast({ text: 'Nothing copied: the models changed before the copy ran' });
    return;
  }
  const destFile = useViewerStore.getState().files.find((f) => f.id === target.fileId);
  const children = Math.max(0, addedCount - selectedCount);
  const n = source.graphIds.length;
  let text = `${plural(n, 'model')} copied to ${shortName(destFile?.name ?? dest0.name)} › LM ${destLm}`;
  if (target.lmId === 'new') text += ' (new)';
  if (children > 0) text += ` + ${children} ${children === 1 ? 'child' : 'children'}`;
  const fileId = target.fileId;
  showToast({
    text,
    action: {
      label: 'Undo',
      run: () => {
        const s = useViewerStore.getState();
        if (!s.files.some((f) => f.id === fileId)) return;
        s.activateFile(fileId);
        s.undo().catch(editFailed);
      },
    },
  });
}

// ---- popover -------------------------------------------------------------------------------

/** Popover form for entry points that are not already inside a Menu. */
export function CopyToMenu({
  source,
  anchor,
  onlyFile,
  asSubmenu,
  onClose,
}: {
  source: CopySource;
  anchor: MenuAnchor;
  /** Restrict to one target file (drop on a file row). */
  onlyFile?: string;
  /** Place it to the right of the anchor, top-aligned (cascade), instead of below it. */
  asSubmenu?: boolean;
  onClose(): void;
}) {
  const files = useViewerStore((s) => s.files);
  // Rebuilt when the open files (names, LMs, counts) change; copyTargetItems reads them itself.
  const items = useMemo(
    () => (files ? copyTargetItems(source, { onlyFile }) : []),
    [files, source, onlyFile],
  );
  return (
    <Menu
      items={items}
      anchor={anchor}
      onClose={onClose}
      placement={asSubmenu ? 'right' : 'below'}
    />
  );
}
