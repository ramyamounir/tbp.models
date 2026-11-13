/**
 * Model name validation and collision-free names (spec multi-file-edit-diff, Phase 2 "Names").
 *
 * The rules apply only to names the user types (rename); names produced by `uniqueName` from an
 * on-disk name (duplicate, copy) are not validated, `uniqueName` only appends ASCII suffixes.
 */

export const MAX_NAME_LENGTH = 255;

/** A lone (unpaired) UTF-16 surrogate; `String.prototype.isWellFormed` is ES2024, beyond our lib. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** Control (Cc) and format (Cf) characters: C0 / C1 controls, zero-width and bidi controls. */
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/** True when `name` has no lone surrogate (`TextEncoder` would write it as U+FFFD). */
export function isWellFormedName(name: string): boolean {
  return !LONE_SURROGATE.test(name);
}

/**
 * Error text for the first failing rule, or undefined when `name` is acceptable. `taken` holds
 * every graph id (readable and unreadable) of the LM; pass `lmId` to name the LM in the message.
 */
export function validateName(
  name: string,
  taken: ReadonlySet<string>,
  lmId?: number,
): string | undefined {
  if (name.trim() === '') return 'Name cannot be empty';
  if (name !== name.trim()) return 'Name cannot start or end with a space';
  if (!isWellFormedName(name)) return 'Name contains an invalid character';
  if (CONTROL_OR_FORMAT.test(name)) return 'Name contains an invisible or control character';
  if (name.length > MAX_NAME_LENGTH) return `Name is too long (max ${MAX_NAME_LENGTH} characters)`;
  if (taken.has(name))
    return lmId === undefined
      ? 'A model with this name already exists in this LM'
      : `A model named "${name}" already exists in LM ${lmId}`;
  return undefined;
}

/** `base` if free, else `base_copy`, `base_copy2`, `base_copy3`, … */
export function uniqueName(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  const first = `${base}_copy`;
  if (!taken.has(first)) return first;
  for (let n = 2; ; n++) {
    const c = `${base}_copy${n}`;
    if (!taken.has(c)) return c;
  }
}
