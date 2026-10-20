/**
 * The whole zip → pickle → storages → Monty adapter → object_id index pipeline as a plain
 * async function with no Worker/DOM dependency (used by worker.ts, scripts/check_loader.ts and
 * the Vitest tests). Uses only Blob, TextDecoder, TextEncoder and (optionally) crypto.subtle.
 */
import { buildObjectIdIndex } from '../model/hash';
import type { ModelFile } from '../model/types';
import { ParseError } from './errors';
import { buildLms, referencedStorages, walkModel } from './monty';
import { unpickle } from './pickle';
import type { LoadStage } from './protocol';
import { STORAGE_KEY_RE, findClass, makePersistentLoad, type StorageRef } from './torch';
import { openZip } from './zip';

const PKL_MAX = 2 ** 31 - 1;

export async function parseModelFile(
  file: Blob,
  fileName: string,
  onProgress?: (stage: LoadStage, pct?: number) => void,
): Promise<ModelFile> {
  onProgress?.('reading');
  const zip = await openZip(file);
  const pklName = `${zip.prefix}/data.pkl`;
  const pklEntry = zip.entries.get(pklName);
  if (!pklEntry) throw new ParseError('No data.pkl in the zip (not a torch file)');
  if (pklEntry.size > PKL_MAX) throw new ParseError('data.pkl too large');
  const pkl = await zip.read(pklName);

  onProgress?.('parsing');
  const storages = new Map<string, StorageRef>();
  const root = unpickle(pkl, { findClass, persistentLoad: makePersistentLoad(storages) });

  onProgress?.('building', 0);
  const walked = walkModel(root);
  const needed = referencedStorages(walked);
  for (let k = 0; k < needed.length; k++) {
    const ref = needed[k];
    if (!STORAGE_KEY_RE.test(ref.key)) throw new ParseError(`Bad storage key ${ref.key}`);
    const name = `${zip.prefix}/data/${ref.key}`;
    const ent = zip.entries.get(name);
    if (!ent) throw new ParseError(`Missing tensor storage ${ref.key}`);
    if (ent.size !== ref.byteLength) {
      throw new ParseError(
        `Tensor storage ${ref.key} has ${ent.size} bytes, expected ${ref.byteLength}`,
      );
    }
    ref.bytes = await zip.read(name);
    if (k % 32 === 31) onProgress?.('building', Math.round((100 * (k + 1)) / needed.length));
  }
  const lms = buildLms(walked);
  // Drop the storage bytes (graphs hold their own copies) so they can be collected.
  for (const ref of needed) ref.bytes = undefined;
  const objectIdIndex = await buildObjectIdIndex(lms);
  onProgress?.('building', 100);
  return {
    fileName,
    byteLength: file.size,
    lms,
    lmToLm: walked.lmToLm,
    smToLm: walked.smToLm,
    objectIdIndex,
  };
}
