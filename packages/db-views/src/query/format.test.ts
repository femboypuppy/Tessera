import { describe, expect, it } from 'vitest';
import { options, property, row, testContext } from '../test/fixtures';
import { readCell } from './cells';
import {
  cellToText,
  cleanNumber,
  dateToPlainText,
  formatDateValue,
  formatDay,
  formatInstant,
  formatNumber,
  numberToPlainText,
} from './format';

const ctx = testContext();

describe('numbers', () => {
  it('formats plain, percent and currency numbers', () => {
    expect(formatNumber(1234.5, undefined, 'en-US')).toBe('1,234.5');
    expect(
      formatNumber(0.1 + 0.2, { format: 'plain', currency: 'USD', precision: null }, 'en-US'),
    ).toBe('0.3');
    expect(formatNumber(3, { format: 'plain', currency: 'USD', precision: 2 }, 'en-US')).toBe(
      '3.00',
    );
    expect(formatNumber(0.256, { format: 'percent', currency: 'USD', precision: 1 }, 'en-US')).toBe(
      '25.6%',
    );
    expect(
      formatNumber(0.25, { format: 'percent', currency: 'USD', precision: null }, 'en-US'),
    ).toBe('25%');
    expect(
      formatNumber(1200, { format: 'currency', currency: 'USD', precision: null }, 'en-US'),
    ).toBe('$1,200.00');
    expect(
      formatNumber(1200, { format: 'currency', currency: 'EUR', precision: 0 }, 'de-DE'),
    ).toMatch(/^1\.200\s€$/);
    expect(formatNumber(1234.5, undefined, 'de-DE')).toBe('1.234,5');
  });

  it('falls back to a plain format when the currency is unusable', () => {
    expect(
      formatNumber(1200, { format: 'currency', currency: '12', precision: null }, 'en-US'),
    ).toBe('1,200');
  });

  it('prints locale-neutral text', () => {
    expect(numberToPlainText(1234.5, undefined)).toBe('1234.5');
    expect(numberToPlainText(0.1 + 0.2, undefined)).toBe('0.3');
    expect(numberToPlainText(0.07, { format: 'percent', currency: 'USD', precision: null })).toBe(
      '7%',
    );
    expect(cleanNumber(1.0000000000000002)).toBe(1);
  });
});

describe('dates', () => {
  it('formats days in every style', () => {
    expect(formatDay('2026-09-23', { format: 'iso', timeFormat: 'locale' }, ctx)).toBe(
      '2026-09-23',
    );
    expect(formatDay('2026-09-23', { format: 'short', timeFormat: 'locale' }, ctx)).toBe('9/23/26');
    expect(formatDay('2026-09-23', { format: 'medium', timeFormat: 'locale' }, ctx)).toBe(
      'Sep 23, 2026',
    );
    expect(formatDay('2026-09-23', { format: 'long', timeFormat: 'locale' }, ctx)).toBe(
      'September 23, 2026',
    );
    expect(formatDay('2026-09-23', undefined, ctx)).toBe('Sep 23, 2026');
  });

  it('formats nearby days relatively and far ones in full', () => {
    const relative = { format: 'relative' as const, timeFormat: 'locale' as const };
    expect(formatDay('2026-09-23', relative, ctx)).toBe('Today');
    expect(formatDay('2026-09-24', relative, ctx)).toBe('Tomorrow');
    expect(formatDay('2026-09-22', relative, ctx)).toBe('Yesterday');
    expect(formatDay('2026-09-26', relative, ctx)).toBe('In 3 days');
    expect(formatDay('2026-09-17', relative, ctx)).toBe('6 days ago');
    expect(formatDay('2026-10-10', relative, ctx)).toBe('Oct 10, 2026');
    expect(formatDay('2026-09-24', relative, testContext({ locale: 'fr-FR' }))).toBe('Demain');
  });

  it('formats values with times, zones and ranges', () => {
    const medium = { format: 'medium' as const, timeFormat: 'locale' as const };
    expect(
      formatDateValue({ start: '2026-09-23T14:30:00Z', includeTime: true }, medium, ctx),
    ).toMatch(/^Sep 23, 2026 2:30\sPM$/);
    expect(
      formatDateValue(
        { start: '2026-09-23T14:30:00Z', includeTime: true },
        { format: 'medium', timeFormat: '24h' },
        ctx,
      ),
    ).toBe('Sep 23, 2026 14:30');
    expect(
      formatDateValue(
        { start: '2026-09-23T14:30:00Z', includeTime: true },
        { format: 'medium', timeFormat: '12h' },
        ctx,
      ),
    ).toMatch(/2:30\sPM$/);
    expect(
      formatDateValue(
        { start: '2026-09-23T14:30:00Z', includeTime: true, timeZone: 'Asia/Tokyo' },
        { format: 'iso', timeFormat: '24h' },
        ctx,
      ),
    ).toBe('2026-09-23 23:30 GMT+9');
    expect(
      formatDateValue(
        { start: '2026-09-23T14:30:00Z', includeTime: true, timeZone: 'Not/AZone' },
        medium,
        ctx,
      ),
    ).toMatch(/^Sep 23, 2026 2:30\sPM$/);
    expect(formatDateValue({ start: '2026-09-23', end: '2026-09-25' }, medium, ctx)).toBe(
      'Sep 23, 2026 → Sep 25, 2026',
    );
    expect(formatDateValue({ start: '2026-09-23', end: '2026-09-23' }, medium, ctx)).toBe(
      'Sep 23, 2026',
    );
    expect(
      formatDateValue(
        { start: '2026-09-23T14:30:00Z', end: '2026-09-23T16:00:00Z', includeTime: true },
        { format: 'iso', timeFormat: '24h' },
        ctx,
      ),
    ).toBe('2026-09-23 14:30 → 2026-09-23 16:00');
    expect(
      formatInstant(Date.UTC(2026, 8, 23, 9, 5), { format: 'iso', timeFormat: '24h' }, ctx),
    ).toBe('2026-09-23 09:05');
  });

  it('prints stable plain text', () => {
    expect(dateToPlainText({ start: '2026-09-23' }, ctx)).toBe('2026-09-23');
    expect(dateToPlainText({ start: '2026-09-23', end: '2026-09-30' }, ctx)).toBe(
      '2026-09-23 → 2026-09-30',
    );
    const ny = testContext({ timeZone: 'America/New_York' });
    expect(dateToPlainText({ start: '2026-09-23T14:30:00Z', includeTime: true }, ny)).toBe(
      '2026-09-23 10:30',
    );
    expect(
      dateToPlainText(
        { start: '2026-09-23T14:30:00Z', includeTime: true, timeZone: 'Asia/Tokyo' },
        ny,
      ),
    ).toBe('2026-09-23 23:30');
  });
});

describe('cellToText', () => {
  it('prints every property type', () => {
    const status = property('status', 'select', { options: options(['todo'], ['done']) });
    const tags = property('tags', 'multiSelect', { options: options(['red'], ['blue']) });
    const cases: Array<[ReturnType<typeof property>, unknown, string]> = [
      [property('title', 'title'), undefined, 'Apollo'],
      [property('text', 'text'), 'Notes', 'Notes'],
      [property('url', 'url'), 'https://nasa.gov', 'https://nasa.gov'],
      [property('email', 'email'), 'a@b.co', 'a@b.co'],
      [property('number', 'number'), 42.5, '42.5'],
      [status, 'done', 'Done'],
      [status, 'ghost', ''],
      [tags, ['blue', 'ghost', 'red'], 'Blue, Red'],
      [property('date', 'date'), { start: '2026-09-23' }, '2026-09-23'],
      [property('check', 'checkbox'), true, 'Yes'],
      [property('check2', 'checkbox'), false, 'No'],
    ];
    for (const [prop, value, expected] of cases) {
      const entry = row('Apollo', value === undefined ? {} : { [prop.id]: value as never });
      expect(cellToText(readCell(entry, prop), prop, ctx), prop.type).toBe(expected);
    }
  });

  it('prints relations, times and formulas', () => {
    const rel = property('rel', 'relation');
    const relCtx = testContext({
      titleOf: (id) => ({ p1: 'Moon', p2: 'Mars' })[id],
      isPageVisible: (id) => id !== 'p3',
    });
    expect(cellToText(['p1', 'p3', 'p2', 'p4'], rel, relCtx)).toBe('Moon, Mars');
    expect(cellToText(['p1'], rel, ctx)).toBe('');
    expect(cellToText(Date.UTC(2026, 8, 23, 8, 0), property('c', 'createdTime'), ctx)).toBe(
      '2026-09-23 08:00',
    );
    expect(cellToText(null, property('f', 'formula'), ctx)).toBe('');
    expect(cellToText(3, property('f2', 'formula'), ctx)).toBe('3');
  });

  it('prints nothing for values of the wrong shape', () => {
    for (const type of [
      'title',
      'number',
      'select',
      'multiSelect',
      'date',
      'relation',
      'createdTime',
    ] as const) {
      expect(cellToText({ nope: true }, property(`x-${type}`, type), ctx)).toBe('');
    }
    expect(cellToText(['x'], property('m', 'multiSelect'), ctx)).toBe('');
  });
});
