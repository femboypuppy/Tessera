import { describe, expect, it } from 'vitest';
import { targetFromHash } from './bridge';

describe('targetFromHash', () => {
  it('reads block and heading targets from a page URL hash', () => {
    expect(targetFromHash('#block-Ab3-x9')).toEqual({ blockId: 'Ab3-x9' });
    expect(targetFromHash('#launch-window')).toEqual({ heading: 'launch-window' });
    expect(targetFromHash('#d%C3%A9part')).toEqual({ heading: 'départ' });
    expect(targetFromHash('')).toBeNull();
    expect(targetFromHash('#')).toBeNull();
    expect(targetFromHash('#%E0%A4%A')).toBeNull();
  });
});
