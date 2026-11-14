/**
 * "Which input channel?" prompt for a diff slot (see `slotChannel.ts`): lists the channels of
 * the model being put in the slot with their kind, node count and features, so the choice also
 * shows what the model contains. When the other slot is filled, each channel says how many of
 * its features that slot's channel has too. Mounted once in App.
 *
 * Channel and feature names are file data: rendered only as React text.
 */
import { useEffect } from 'react';
import { channelFeatureNames } from '../../diff/compare';
import { resolveSlot } from '../../diff/useDiff';
import { useViewerStore } from '../../state/store';
import { DisplayName } from '../../util/DisplayName';
import { Dialog } from '../ui/Dialog';
import { btnSecondary } from './diffFormat';
import { KindChip } from './parts';
import { graphOf, settleChannelPrompt, useChannelPrompt } from './slotChannel';
import { otherSlot } from './slotDrop';
import { SlotBadge } from './SlotStrip';

const hasOwn = (rec: Record<string, unknown>, k: string) =>
  Object.prototype.hasOwnProperty.call(rec, k);

export function ChannelPrompt() {
  const head = useChannelPrompt((s) => s.queue[0]);
  const files = useViewerStore((s) => s.files);
  const diff = useViewerStore((s) => s.diff);
  // Looked up on every render (`files` is a dependency of this component): a model deleted
  // while the prompt is open drops its request.
  const graph = head ? graphOf(head.target) : undefined;
  useEffect(() => {
    if (head && !graph) settleChannelPrompt(undefined);
  }, [head, graph]);
  if (!head || !graph) return null;
  const letter = head.slot.toUpperCase();
  const other = otherSlot(head.slot);
  const otherLetter = other.toUpperCase();
  const otherChannel = resolveSlot(files, diff[other])?.channel;
  const cur = diff[head.slot];
  const current =
    cur &&
    cur.fileId === head.target.fileId &&
    cur.lmId === head.target.lmId &&
    cur.graphId === head.target.graphId
      ? cur.channel
      : undefined;
  const names = graph.channels.map((c) => c.channel);
  const focusName =
    otherChannel && names.includes(otherChannel.channel)
      ? otherChannel.channel
      : current !== undefined && names.includes(current)
        ? current
        : names[0];
  const seen = new Set<string>();

  return (
    <Dialog
      key={`${head.slot}:${head.target.fileId}:${head.target.lmId}:${head.target.graphId}`}
      open
      width={480}
      title={
        <span className="flex items-center gap-2">
          <SlotBadge slot={head.slot} />
          Input channel for slot {letter}
        </span>
      }
      subtitle={
        <>
          <DisplayName value={head.target.graphId} max={48} className="font-mono" /> has{' '}
          {graph.channels.length} input channels, each with its own graph. Pick the one to compare.
        </>
      }
      onCancel={() => settleChannelPrompt(undefined)}
      footer={
        <button
          type="button"
          className={btnSecondary}
          onClick={() => settleChannelPrompt(undefined)}
        >
          Cancel
        </button>
      }
    >
      <ul className="flex flex-col gap-2">
        {graph.channels.map((c, k) => {
          // A repeated channel name (malformed file) can only address its first channel.
          const dup = seen.has(c.channel);
          seen.add(c.channel);
          const feats = channelFeatureNames(c);
          const shared = otherChannel
            ? feats.filter((f) => hasOwn(otherChannel.features, f)).length
            : 0;
          return (
            <li key={k}>
              <button
                type="button"
                disabled={dup}
                data-autofocus={!dup && c.channel === focusName ? true : undefined}
                onClick={() => settleChannelPrompt(c.channel)}
                className="flex w-full flex-col gap-1.5 rounded-lg border border-border bg-bg px-3 py-2.5 text-left hover:border-accent hover:bg-accent-bg focus-visible:border-accent focus-visible:bg-accent-bg disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="flex w-full min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate font-mono text-[13px] font-semibold text-text">
                    <DisplayName value={c.channel} max={48} />
                  </span>
                  <KindChip kind={c.kind} />
                  {c.channel === current && !dup && (
                    <span className="shrink-0 text-[11px] text-accent">current</span>
                  )}
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-muted">
                    {c.n.toLocaleString('en-US')} {c.n === 1 ? 'node' : 'nodes'}
                  </span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {feats.length === 0 && (
                    <span className="text-[11px] text-faint">no features</span>
                  )}
                  {feats.map((f) => {
                    const inOther = !otherChannel || hasOwn(otherChannel.features, f);
                    return (
                      <span
                        key={f}
                        className={`max-w-full truncate rounded border px-1.5 py-px font-mono text-[10px] ${
                          inOther
                            ? 'border-border bg-panel text-text'
                            : 'border-dashed border-border text-faint'
                        }`}
                      >
                        <DisplayName value={f} max={32} />
                      </span>
                    );
                  })}
                </span>
                {otherChannel && (
                  <span className="text-[11px] text-muted">
                    {shared} of {feats.length} {feats.length === 1 ? 'feature' : 'features'} also in{' '}
                    {otherLetter} ·{' '}
                    <DisplayName value={otherChannel.channel} max={32} className="font-mono" />
                    {dup ? ' · repeated channel name' : ''}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
