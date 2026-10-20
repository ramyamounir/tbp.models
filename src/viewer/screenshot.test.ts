import { describe, expect, it } from 'vitest';
import { screenshotFileName } from './screenshot';

describe('screenshotFileName', () => {
  it('keeps safe ids as-is', () => {
    expect(screenshotFileName(1, '002_cube_tbp_horz')).toBe(
      'tbp-model-viewer_lm1_002_cube_tbp_horz.png',
    );
  });

  it('replaces unsafe characters', () => {
    const name = screenshotFileName(0, '../a b/‮c');
    expect(name.startsWith('tbp-model-viewer_lm0_')).toBe(true);
    expect(name.endsWith('.png')).toBe(true);
    const id = name.slice('tbp-model-viewer_lm0_'.length, -'.png'.length);
    expect(id).toMatch(/^[A-Za-z0-9_.-]+$/);
    expect(id).toBe('.._a_b__c');
  });

  it('cuts the id part to 80 characters', () => {
    const name = screenshotFileName(3, 'x'.repeat(200));
    const id = name.slice('tbp-model-viewer_lm3_'.length, -'.png'.length);
    expect(id).toHaveLength(80);
  });

  it('falls back to "model"', () => {
    expect(screenshotFileName(2, undefined)).toBe('tbp-model-viewer_lm2_model.png');
    expect(screenshotFileName(2, '')).toBe('tbp-model-viewer_lm2_model.png');
  });
});
