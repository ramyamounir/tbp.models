/**
 * The diff result for the store's slots and settings (spec multi-file-edit-diff Phase 6
 * "Store"): derived, not stored. Memoised on the two channel objects, both files'
 * `view.objectIdIndex` and the settings object (identity), so an edit that changes either
 * file's object_id index re-runs the comparison even when the slot channels are unchanged.
 * The comparison runs in a `setTimeout(0)` after a "comparing" state has been rendered.
 */
import { useEffect, useState } from 'react';
import type { ChannelGraph, ModelFile, ObjectGraph, ObjectIdIndex } from '../model/types';
import { useViewerStore, type OpenFile, type SlotRef } from '../state/store';
import { diffChannels, type DiffResult } from './compare';
import type { DiffSettings } from './settings';

export interface ResolvedSlot {
  ref: SlotRef;
  file: OpenFile;
  graph: ObjectGraph;
  /** The compared channel: `ref.channel` of `graph`. */
  channel: ChannelGraph;
}

/** The slot's file, readable graph and channel, or undefined when any no longer exists. */
export function resolveSlot(
  files: readonly OpenFile[],
  ref: SlotRef | undefined,
): ResolvedSlot | undefined {
  if (!ref) return undefined;
  const file = files.find((f) => f.id === ref.fileId);
  const graph = file?.view.lms[ref.lmId]?.graphs.get(ref.graphId);
  const channel = graph?.channels.find((c) => c.channel === ref.channel);
  return file && graph && channel ? { ref, file, graph, channel } : undefined;
}

export type DiffStatus =
  | { status: 'empty' } // no slot filled
  | { status: 'single'; slot: 'a' | 'b'; a?: ResolvedSlot; b?: ResolvedSlot } // one slot filled
  | { status: 'comparing'; a: ResolvedSlot; b: ResolvedSlot }
  | { status: 'done'; a: ResolvedSlot; b: ResolvedSlot; result: DiffResult };

interface Inputs {
  channelA: ChannelGraph;
  channelB: ChannelGraph;
  indexA: ObjectIdIndex;
  indexB: ObjectIdIndex;
  settings: DiffSettings;
}

const sameInputs = (p: Inputs, q: Inputs) =>
  p.channelA === q.channelA &&
  p.channelB === q.channelB &&
  p.indexA === q.indexA &&
  p.indexB === q.indexB &&
  p.settings === q.settings;

/** Single-entry cache: survives toggling the diff view (unmount / remount) without re-running. */
let cache: { inputs: Inputs; result: DiffResult } | undefined;

/** Cached result for `inputs`, if the last comparison had exactly these inputs. */
export function cachedDiff(inputs: Inputs): DiffResult | undefined {
  return cache && sameInputs(cache.inputs, inputs) ? cache.result : undefined;
}

/** Runs (or returns the cached) comparison synchronously. */
export function computeDiff(inputs: Inputs, aFile: ModelFile, bFile: ModelFile): DiffResult {
  const hit = cachedDiff(inputs);
  if (hit) return hit;
  const result = diffChannels(inputs.channelA, aFile, inputs.channelB, bFile, inputs.settings);
  cache = { inputs, result };
  return result;
}

export function useDiff(): DiffStatus {
  const files = useViewerStore((s) => s.files);
  const refA = useViewerStore((s) => s.diff.a);
  const refB = useViewerStore((s) => s.diff.b);
  const settings = useViewerStore((s) => s.diff.settings);
  const a = resolveSlot(files, refA);
  const b = resolveSlot(files, refB);
  const inputs: Inputs | undefined =
    a && b
      ? {
          channelA: a.channel,
          channelB: b.channel,
          indexA: a.file.view.objectIdIndex,
          indexB: b.file.view.objectIdIndex,
          settings,
        }
      : undefined;

  const [done, setDone] = useState<{ inputs: Inputs; result: DiffResult } | undefined>(undefined);
  const hit = inputs ? cachedDiff(inputs) : undefined;
  const current = inputs && done && sameInputs(done.inputs, inputs) ? done.result : hit;

  const channelA = inputs?.channelA;
  const channelB = inputs?.channelB;
  const indexA = inputs?.indexA;
  const indexB = inputs?.indexB;
  const needsRun = inputs !== undefined && current === undefined;
  const aView = a?.file.view;
  const bView = b?.file.view;

  useEffect(() => {
    if (!needsRun || !channelA || !channelB || !indexA || !indexB || !aView || !bView) return;
    const run: Inputs = { channelA, channelB, indexA, indexB, settings };
    const t = setTimeout(() => {
      setDone({ inputs: run, result: computeDiff(run, aView, bView) });
    }, 0);
    return () => clearTimeout(t);
    // aView / bView are read for object_id resolution only; their objectIdIndex is a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsRun, channelA, channelB, indexA, indexB, settings]);

  if (!a && !b) return { status: 'empty' };
  if (!a || !b) return { status: 'single', slot: a ? 'a' : 'b', a, b };
  if (current) return { status: 'done', a, b, result: current };
  return { status: 'comparing', a, b };
}

/**
 * The finished comparison for the store's current slots and settings, when it has been computed
 * (the keyboard handler's ← / → difference stepping, outside React). Undefined while comparing.
 */
export function currentDiffResult(): DiffResult | undefined {
  const s = useViewerStore.getState();
  const a = resolveSlot(s.files, s.diff.a);
  const b = resolveSlot(s.files, s.diff.b);
  if (!a || !b) return undefined;
  return cachedDiff({
    channelA: a.channel,
    channelB: b.channel,
    indexA: a.file.view.objectIdIndex,
    indexB: b.file.view.objectIdIndex,
    settings: s.diff.settings,
  });
}
