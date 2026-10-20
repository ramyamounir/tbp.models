import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256 } from './sha256';

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const te = new TextEncoder();

const GRAPH_IDS = [
  '001_cube',
  '021_logo_tbp',
  '010_disk_numenta_vert',
  '013_cylinder_tbp_vert',
  '005_x',
  'mug',
];

describe('sha256 (pure JS)', () => {
  it('matches the FIPS 180-4 "abc" vector', () => {
    expect(hex(sha256(te.encode('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  const inputs = [
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(63),
    'a'.repeat(64),
    'a'.repeat(65),
    'x'.repeat(1000),
    'é漢😀',
    ...GRAPH_IDS,
  ];
  it.each(
    inputs.map((s) => [s.length > 20 ? `${s.slice(0, 8)}… (${s.length})` : JSON.stringify(s), s]),
  )('matches node:crypto for %s', (_label, s) => {
    const bytes = te.encode(s);
    expect(hex(sha256(bytes))).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
});
