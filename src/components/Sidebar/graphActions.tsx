/**
 * Item arrays of the graph row menu and the bulk action bar (spec multi-file-edit-diff Phase 3a
 * "Item arrays"; "Copy to…" from Phase 3b). Later phases insert their items by stable id: `copyTo` after `duplicate`
 * (Phase 3b), `sendToDiff` with `sep-before-diff` before `sep-before-delete` (Phase 7a).
 */
import type { ReactNode } from 'react';
import type { GraphOrigin } from '../../model/types';
import { duplicateGraphsAction, requestDeleteGraphs } from '../../state/editUi';
import { useViewerStore } from '../../state/store';
import type { MenuItem } from '../ui/Menu';
import { copyTargetItems } from './CopyToMenu';

export interface GraphActionContext {
  fileId: string;
  lmId: number;
  /** Readable ids of the row, or of the whole multi-selection. */
  graphIds: string[];
  /** Origins of the targeted unreadable rows. */
  unreadableOrigins: GraphOrigin[];
  /** unreadableOrigins.length > 0 */
  unreadable: boolean;
  /** Only for a single row. */
  startRename(): void;
  /** Opens the "Copy to…" popover (`CopyToMenu`) at `anchor` (bulk bar, Phase 3b). */
  openCopyTo?(anchor: HTMLElement): void;
}

export interface BulkAction {
  id: string;
  label: string;
  icon: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
  /** `anchor` = the bar button, for actions that open a popover (Copy to…). */
  run(anchor: HTMLElement): void;
}

export type BulkItem = BulkAction | { divider: true; id: string };

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

export function PencilIcon() {
  return (
    <svg {...iconProps}>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  );
}

export function DuplicateIcon() {
  return (
    <svg {...iconProps}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

export function CopyToIcon() {
  return (
    <svg {...iconProps}>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function TrashIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 6h18" />
      <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function CompareIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="7" height="14" rx="1.5" />
      <rect x="14" y="5" width="7" height="14" rx="1.5" />
      <path d="M12 3v18" />
    </svg>
  );
}

/** Puts a readable graph in diff slot `slot` (does not open the diff view; Phase 7a). */
function sendToSlot(slot: 'a' | 'b', fileId: string, lmId: number, graphId: string): void {
  useViewerStore.getState().setSlot(slot, { fileId, lmId, graphId });
}

const rowCount = (ctx: GraphActionContext) => ctx.graphIds.length + ctx.unreadableOrigins.length;

/** Row "⋯" / right-click menu. Unreadable rows get only Delete. */
// eslint-disable-next-line react-refresh/only-export-components -- spec API (Phase 3a)
export function buildRowMenu(ctx: GraphActionContext): MenuItem[] {
  const del: MenuItem = {
    kind: 'item',
    id: 'delete',
    label: rowCount(ctx) > 1 ? `Delete ${rowCount(ctx)} models` : 'Delete',
    icon: <TrashIcon />,
    shortcut: 'Del',
    danger: true,
    onSelect: () => requestDeleteGraphs(ctx.fileId, ctx.lmId, ctx.graphIds, ctx.unreadableOrigins),
  };
  // A single unreadable row, or a selection made only of unreadable rows.
  if (ctx.graphIds.length === 0) return [del];
  const single = rowCount(ctx) === 1;
  return [
    {
      kind: 'item',
      id: 'rename',
      label: 'Rename',
      icon: <PencilIcon />,
      shortcut: 'F2',
      disabled: !single,
      title: single ? undefined : 'Select a single model to rename it',
      onSelect: ctx.startRename,
    },
    {
      kind: 'item',
      id: 'duplicate',
      label: ctx.graphIds.length > 1 ? `Duplicate ${ctx.graphIds.length} models` : 'Duplicate',
      icon: <DuplicateIcon />,
      shortcut: 'Ctrl D',
      onSelect: () => duplicateGraphsAction(ctx.fileId, ctx.lmId, ctx.graphIds),
    },
    ctx.unreadable
      ? {
          kind: 'item',
          id: 'copyTo',
          label: 'Copy to…',
          icon: <CopyToIcon />,
          disabled: true,
          title: 'Unreadable graphs cannot be copied',
        }
      : {
          kind: 'item',
          id: 'copyTo',
          label: 'Copy to…',
          icon: <CopyToIcon />,
          submenu: copyTargetItems({ fileId: ctx.fileId, lmId: ctx.lmId, graphIds: ctx.graphIds }),
        },
    { kind: 'separator', id: 'sep-before-diff' },
    sendToDiffItem(ctx),
    { kind: 'separator', id: 'sep-before-delete' },
    del,
  ];
}

/** Row menu "Send to diff slot ▸" with A / B; only for a single readable row. */
function sendToDiffItem(ctx: GraphActionContext): MenuItem {
  const one = ctx.graphIds.length === 1 && !ctx.unreadable;
  if (!one) {
    return {
      kind: 'item',
      id: 'sendToDiff',
      label: 'Send to diff slot',
      icon: <CompareIcon />,
      disabled: true,
      title: ctx.unreadable
        ? 'Unreadable graphs cannot be compared'
        : 'Select a single model, or use "Send to diff" in the bulk bar',
    };
  }
  const graphId = ctx.graphIds[0];
  return {
    kind: 'item',
    id: 'sendToDiff',
    label: 'Send to diff slot',
    icon: <CompareIcon />,
    submenu: [
      {
        kind: 'item',
        id: 'sendToDiff-a',
        label: 'A',
        onSelect: () => sendToSlot('a', ctx.fileId, ctx.lmId, graphId),
      },
      {
        kind: 'item',
        id: 'sendToDiff-b',
        label: 'B',
        onSelect: () => sendToSlot('b', ctx.fileId, ctx.lmId, graphId),
      },
    ],
  };
}

/** Bulk action bar buttons (shown for two or more selected rows). */
// eslint-disable-next-line react-refresh/only-export-components -- spec API (Phase 3a)
export function buildBulkActions(ctx: GraphActionContext): BulkItem[] {
  const noReadable = ctx.graphIds.length === 0;
  const twoReadable = ctx.graphIds.length === 2 && !ctx.unreadable;
  return [
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: <DuplicateIcon />,
      disabled: noReadable,
      title: noReadable ? 'Unreadable graphs cannot be duplicated' : 'Duplicate (Ctrl D)',
      run: () => duplicateGraphsAction(ctx.fileId, ctx.lmId, ctx.graphIds),
    },
    {
      // Unreadable rows of the selection are left out; disabled when none remain.
      id: 'copyTo',
      label: 'Copy to…',
      icon: <CopyToIcon />,
      disabled: noReadable,
      title: noReadable ? 'Unreadable graphs cannot be copied' : 'Copy to…',
      run: (anchor) => ctx.openCopyTo?.(anchor),
    },
    {
      // Exactly two readable graphs: the first selected goes to A, the second to B.
      id: 'sendToDiff',
      label: 'Send to diff',
      icon: <CompareIcon />,
      disabled: !twoReadable,
      title: twoReadable ? 'Send to diff (first → A, second → B)' : 'Select exactly two models',
      run: () => {
        sendToSlot('a', ctx.fileId, ctx.lmId, ctx.graphIds[0]);
        sendToSlot('b', ctx.fileId, ctx.lmId, ctx.graphIds[1]);
      },
    },
    { divider: true, id: 'sep-before-delete' },
    {
      id: 'delete',
      label: 'Delete',
      icon: <TrashIcon />,
      danger: true,
      title: 'Delete (Del)',
      run: () => requestDeleteGraphs(ctx.fileId, ctx.lmId, ctx.graphIds, ctx.unreadableOrigins),
    },
  ];
}
