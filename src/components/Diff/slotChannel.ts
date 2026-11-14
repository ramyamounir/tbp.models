/**
 * Filling a diff slot from the UI. A slot holds one input channel of a model, so every entry
 * point (drop on a slot or pane, "Send to diff slot", the two-model compare action) goes through
 * `requestSlots`: a model with one channel is set directly, a model with several opens the
 * channel prompt (`ChannelPrompt`, mounted once in App), one model at a time.
 */
import { create } from 'zustand';
import type { ObjectGraph } from '../../model/types';
import { useViewerStore } from '../../state/store';
import { displayName } from '../../util/displayName';
import { showToast } from '../ui/Toast';
import type { Slot } from './slotDrop';

/** A readable graph of an open file. */
export interface SlotTarget {
  fileId: string;
  lmId: number;
  graphId: string;
}

export interface SlotRequest {
  slot: Slot;
  target: SlotTarget;
}

/** Requests waiting for a channel choice; the prompt shows the first. */
export const useChannelPrompt = create<{ queue: SlotRequest[] }>(() => ({ queue: [] }));

export function graphOf(t: SlotTarget): ObjectGraph | undefined {
  const f = useViewerStore.getState().files.find((x) => x.id === t.fileId);
  return f?.view.lms[t.lmId]?.graphs.get(t.graphId);
}

export function requestSlots(requests: readonly SlotRequest[]): void {
  const pending: SlotRequest[] = [];
  for (const r of requests) {
    const g = graphOf(r.target);
    if (!g) continue;
    if (g.channels.length === 0) {
      showToast({ text: `${displayName(r.target.graphId).text} has no input channel to compare` });
    } else if (g.channels.length === 1) {
      useViewerStore.getState().setSlot(r.slot, { ...r.target, channel: g.channels[0].channel });
    } else {
      pending.push({ slot: r.slot, target: { ...r.target } });
    }
  }
  if (pending.length > 0) useChannelPrompt.setState((s) => ({ queue: [...s.queue, ...pending] }));
}

export const requestSlot = (slot: Slot, target: SlotTarget): void =>
  requestSlots([{ slot, target }]);

/** Answers the first request: `channel` fills its slot, undefined leaves the slot as it was. */
export function settleChannelPrompt(channel: string | undefined): void {
  const [head, ...rest] = useChannelPrompt.getState().queue;
  if (!head) return;
  useChannelPrompt.setState({ queue: rest });
  if (channel !== undefined)
    useViewerStore.getState().setSlot(head.slot, { ...head.target, channel });
}

/**
 * The channel a slot takes when its model changes without a prompt (settings dialog): the one
 * named `prefer` when the graph has it, else the first.
 */
export function defaultChannel(g: ObjectGraph | undefined, prefer?: string): string | undefined {
  if (!g) return undefined;
  const hit = prefer !== undefined && g.channels.some((c) => c.channel === prefer);
  return hit ? prefer : g.channels[0]?.channel;
}
