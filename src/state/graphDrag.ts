/**
 * Graph-row drag and drop (spec multi-file-edit-diff Phase 1 / Phase 3b "Drag and drop").
 *
 * The drag source is kept in module state, not in `dataTransfer`. The `dataTransfer` entry under
 * `GRAPH_DRAG_TYPE` is only a marker (so targets can recognise a graph drag in `dragover`, where
 * `getData` is not readable) and carries a random token, never the payload. Another tab, app
 * instance or application can put any string under that type, so nothing read from
 * `dataTransfer` is acted on except the token comparison in `readGraphDrop`.
 */
import type { DragEvent as ReactDragEvent } from 'react';
import { newFileId, useViewerStore, type OpenFile } from './store';

export const GRAPH_DRAG_TYPE = 'application/x-tbp-graph';

/** True when the drag carries graph rows (never a file drag). */
export function isGraphDrag(e: DragEvent | ReactDragEvent): boolean {
  return e.dataTransfer?.types.includes(GRAPH_DRAG_TYPE) ?? false;
}

/** Readable graph ids, all in LM `lmId` of file `fileId`. */
export interface GraphDragPayload {
  fileId: string;
  lmId: number;
  graphIds: string[];
}

interface ActiveGraphDrag extends GraphDragPayload {
  token: string;
}

let current: ActiveGraphDrag | null = null;

/**
 * Called with a payload on dragstart (returns the token to write as the marker), with null on
 * dragend. Always clears an earlier drag first, so a drag whose dragend never fired (its row
 * unmounted mid-drag) cannot leak into a new one.
 */
export function setGraphDrag(payload: GraphDragPayload | null): string | undefined {
  current = null;
  if (payload === null) return undefined;
  const token = newFileId();
  current = {
    fileId: payload.fileId,
    lmId: payload.lmId,
    graphIds: payload.graphIds.slice(),
    token,
  };
  return token;
}

/** The current drag of this tab, or null. */
export function getGraphDrag(): GraphDragPayload | null {
  if (current === null) return null;
  return { fileId: current.fileId, lmId: current.lmId, graphIds: current.graphIds.slice() };
}

/**
 * Checks the payload against the current store state: the source file is open, the LM exists
 * and every id is a readable graph of that LM. Returns a fresh payload (graphIds deduplicated,
 * order kept) or null.
 */
export function validateGraphDrag(
  p: GraphDragPayload,
  files: readonly OpenFile[],
): GraphDragPayload | null {
  const f = files.find((x) => x.id === p.fileId);
  if (!f) return null;
  if (!Number.isInteger(p.lmId) || p.lmId < 0 || p.lmId >= f.view.lms.length) return null;
  const lm = f.view.lms[p.lmId];
  if (!Array.isArray(p.graphIds) || p.graphIds.length === 0) return null;
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const id of p.graphIds) {
    if (typeof id !== 'string' || !lm.graphs.has(id)) return null;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return { fileId: p.fileId, lmId: p.lmId, graphIds: ids };
}

/**
 * The only way a drop handler gets a payload: marker present, a drag started in this tab, the
 * token matches and the payload is still valid. Clears the drag state.
 */
export function readGraphDrop(e: DragEvent | ReactDragEvent): GraphDragPayload | null {
  if (!isGraphDrag(e)) return null;
  if (current === null) return null;
  let marker = '';
  try {
    marker = e.dataTransfer?.getData(GRAPH_DRAG_TYPE) ?? '';
  } catch {
    return null;
  }
  if (marker !== current.token) return null;
  const payload: GraphDragPayload = current;
  current = null;
  return validateGraphDrag(payload, useViewerStore.getState().files);
}

/** True while a graph drag of this tab is over the target (the `dragover` / `dragenter` test). */
export function acceptsGraphDrag(e: DragEvent | ReactDragEvent): boolean {
  return isGraphDrag(e) && current !== null;
}
