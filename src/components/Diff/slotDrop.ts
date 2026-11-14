/**
 * Drop handling for diff slots (spec multi-file-edit-diff Phase 7a "Drop targets"): the slots
 * in the pane headers and the panes accept graph-row drags of this tab only, through `graphDrag.ts`.
 * Nothing is parsed from `dataTransfer`; the validated payload builds the slot requests (a model
 * with several input channels asks which one to compare, see `slotChannel.ts`).
 */
import { useState, type DragEvent } from 'react';
import { acceptsGraphDrag, readGraphDrop } from '../../state/graphDrag';
import { requestSlots } from './slotChannel';

export type Slot = 'a' | 'b';
export const otherSlot = (s: Slot): Slot => (s === 'a' ? 'b' : 'a');

export interface SlotDropProps {
  onDragEnter(e: DragEvent): void;
  onDragOver(e: DragEvent): void;
  onDragLeave(e: DragEvent): void;
  onDrop(e: DragEvent): void;
}

/**
 * `over` is true while a graph drag of this tab is over the element. One dragged graph sets
 * `slot`; with two or more, the first goes to `slot` and the second to the other slot.
 */
export function useSlotDrop(slot: Slot): { over: boolean; props: SlotDropProps } {
  const [over, setOver] = useState(false);
  const onDragOver = (e: DragEvent) => {
    if (!acceptsGraphDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!over) setOver(true);
  };
  const props: SlotDropProps = {
    onDragEnter: onDragOver,
    onDragOver,
    onDragLeave: (e) => {
      const to = e.relatedTarget;
      if (to instanceof Node && e.currentTarget.contains(to)) return;
      setOver(false);
    },
    onDrop: (e) => {
      setOver(false);
      if (!acceptsGraphDrag(e)) return;
      e.preventDefault();
      e.stopPropagation();
      const payload = readGraphDrop(e);
      if (payload === null) return;
      const target = (graphId: string) => ({
        fileId: payload.fileId,
        lmId: payload.lmId,
        graphId,
      });
      const requests = [{ slot, target: target(payload.graphIds[0]) }];
      if (payload.graphIds.length >= 2)
        requests.push({ slot: otherSlot(slot), target: target(payload.graphIds[1]) });
      requestSlots(requests);
    },
  };
  return { over, props };
}
