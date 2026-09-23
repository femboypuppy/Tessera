import { afterEach, describe, expect, it, vi } from 'vitest';
import { createQueryContext, systemTimeZone } from './types';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('createQueryContext', () => {
  it('fills in the clock, zone and locale', () => {
    const before = Date.now();
    const ctx = createQueryContext();
    expect(ctx.now).toBeGreaterThanOrEqual(before);
    expect(ctx.timeZone).toBe(systemTimeZone());
    expect(ctx.weekStartsOn).toBe(1);
    expect(typeof ctx.locale).toBe('string');
  });

  it('keeps valid input and replaces invalid zones and locales', () => {
    const titleOf = () => 'x';
    const isPageVisible = () => true;
    const ctx = createQueryContext({
      now: 5,
      timeZone: 'Asia/Tokyo',
      locale: 'fr-FR',
      weekStartsOn: 0,
      titleOf,
      isPageVisible,
    });
    expect(ctx).toEqual({
      now: 5,
      timeZone: 'Asia/Tokyo',
      locale: 'fr-FR',
      weekStartsOn: 0,
      titleOf,
      isPageVisible,
    });
    const bad = createQueryContext({ timeZone: 'Mars/Olympus', locale: 'not a locale!' });
    expect(bad.timeZone).toBe(systemTimeZone());
    expect(bad.locale).toBe('en-US');
  });

  it('falls back to en-US without a navigator language', () => {
    vi.stubGlobal('navigator', { language: '' });
    expect(createQueryContext().locale).toBe('en-US');
  });

  it('falls back to UTC when the runtime cannot tell the zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => {
      throw new RangeError('no zones here');
    });
    expect(systemTimeZone()).toBe('UTC');
  });
});
