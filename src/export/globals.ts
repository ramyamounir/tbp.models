/**
 * Pickle globals of an exported tree (spec multi-file-edit-diff Phase 4b "Pickle globals").
 * A heuristic warning, not a safety check: the viewer never executes pickle code, but copied
 * subtrees carry every global of their source file into the export.
 */
import { forEachChild } from './astWalk';
import type { PNode } from './pickleAst';

const EXPECTED_ROOTS = ['tbp.monty', 'numpy', 'torch', 'scipy', 'omegaconf'];
const EXPECTED_BUILTINS = new Set([
  'set',
  'frozenset',
  'dict',
  'list',
  'tuple',
  'int',
  'long',
  'float',
  'complex',
  'bool',
  'str',
  'bytes',
  'bytearray',
  'slice',
  'range',
  'object',
]);

export function isExpectedGlobal(module: string, name: string): boolean {
  if (EXPECTED_ROOTS.some((r) => module === r || module.startsWith(`${r}.`))) return true;
  if (module === 'collections' || module === 'typing') return true;
  if (module === '_codecs' && name === 'encode') return true;
  if ((module === 'builtins' || module === '__builtin__') && EXPECTED_BUILTINS.has(name))
    return true;
  return false;
}

/** Distinct `module.name` of every reachable global node not on the expected list, sorted. */
export function unexpectedGlobals(root: PNode): string[] {
  const out = new Set<string>();
  const visited = new Set<PNode>([root]);
  const stack: PNode[] = [root];
  const visit = (c: PNode) => {
    if (!visited.has(c)) {
      visited.add(c);
      stack.push(c);
    }
  };
  while (stack.length > 0) {
    const n = stack.pop()!;
    if (n.t === 'global' && !isExpectedGlobal(n.module, n.name)) out.add(`${n.module}.${n.name}`);
    forEachChild(n, visit);
  }
  return [...out].sort();
}
