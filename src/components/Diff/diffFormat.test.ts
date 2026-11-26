import { describe, expect, it } from 'vitest';
import { formatDelta } from './diffFormat';

describe('formatDelta', () => {
  it('keeps the usual fixed notation', () => {
    expect(formatDelta(3.14, '%R')).toBe('3.1 % R');
    expect(formatDelta(12.44, '°')).toBe('12.4°');
    expect(formatDelta(0.0014, 'm')).toBe('1.4 mm');
    expect(formatDelta(0.18, '')).toBe('0.18');
    expect(formatDelta(0.0012, '')).toBe('0.0012');
    expect(formatDelta(0, '%R')).toBe('0.0 % R');
    expect(formatDelta(0, '')).toBe('0.00');
  });

  it('never rounds a non-zero delta to zero', () => {
    expect(formatDelta(6.31e-14, '%R')).toBe('6.3e-14 % R');
    expect(formatDelta(1.71e-6, '°')).toBe('1.7e-6°');
    expect(formatDelta(6.31e-16, 'm')).toBe('6.3e-16 m');
    expect(formatDelta(1.43e-13, '')).toBe('1.4e-13');
  });

  it('formats non-finite values', () => {
    expect(formatDelta(Infinity, '')).toBe('∞');
    expect(formatDelta(NaN, '°')).toBe('—');
  });
});
