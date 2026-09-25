import { describe, expect, it } from 'vitest';
import { suggestOptionColor } from './option-colors';

describe('suggestOptionColor', () => {
  it('colors statuses and priorities by what they mean', () => {
    expect(suggestOptionColor('Done')).toBe('green');
    expect(suggestOptionColor('In progress')).toBe('blue');
    expect(suggestOptionColor('in_review')).toBe('yellow');
    expect(suggestOptionColor('Blocked')).toBe('red');
    expect(suggestOptionColor('Not started')).toBe('gray');
    expect(suggestOptionColor(' High ')).toBe('red');
    expect(suggestOptionColor('Low')).toBe('gray');
  });

  it('leaves other names to the palette', () => {
    expect(suggestOptionColor('Maya')).toBeUndefined();
    expect(suggestOptionColor('History')).toBeUndefined();
    expect(suggestOptionColor('')).toBeUndefined();
  });
});
