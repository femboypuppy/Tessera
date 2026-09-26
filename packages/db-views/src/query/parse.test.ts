import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { property, testContext } from '../test/fixtures';
import {
  isCurrencyCode,
  looksLikeEmail,
  looksLikeUrl,
  parseBooleanText,
  parseCellText,
  parseDateText,
  parseNumberText,
  splitNames,
} from './parse';

const ctx = testContext();
const ny = testContext({ timeZone: 'America/New_York' });

describe('parseNumberText', () => {
  it('reads numbers people and spreadsheets write', () => {
    const cases: Array<[string, number]> = [
      ['42', 42],
      ['-3', -3],
      ['+4', 4],
      ['.5', 0.5],
      ['1e3', 1000],
      ['1,234.5', 1234.5],
      ['1.234,5', 1234.5],
      ['1 234,5', 1234.5],
      ["1'234.5", 1234.5],
      ['1,234', 1234],
      ['1,5', 1.5],
      ['1.234.567', 1234567],
      ['1.234', 1.234],
      ['(50)', -50],
      ['($1,200.50)', -1200.5],
    ];
    for (const [text, value] of cases) expect(parseNumberText(text)?.value, text).toBe(value);
  });

  it('recognizes percentages and currencies', () => {
    expect(parseNumberText('12.5%')).toEqual({ value: 0.125, percent: true, currency: null });
    expect(parseNumberText('$1,200')).toEqual({ value: 1200, percent: false, currency: 'USD' });
    expect(parseNumberText('-$5')).toEqual({ value: -5, percent: false, currency: 'USD' });
    expect(parseNumberText('€5')?.currency).toBe('EUR');
    expect(parseNumberText('5 €')?.currency).toBe('EUR');
    expect(parseNumberText('1200 EUR')?.currency).toBe('EUR');
    expect(parseNumberText('CHF 10')).toEqual({ value: 10, percent: false, currency: 'CHF' });
    expect(parseNumberText('JPY 300')?.currency).toBe('JPY');
  });

  it('rejects everything else', () => {
    for (const text of [
      '',
      '  ',
      'abc',
      'TOTAL 5',
      '5 ABC',
      '12.5.3',
      '1,2,3',
      '--5',
      'e5',
      '1e999',
      '5%%',
    ])
      expect(parseNumberText(text), text).toBeNull();
    expect(isCurrencyCode('USD')).toBe(true);
    expect(isCurrencyCode('ABC')).toBe(false);
  });
});

describe('parseBooleanText', () => {
  it('reads checkbox words', () => {
    for (const word of ['yes', 'TRUE', 'x', '✓', 'Checked', 'done'])
      expect(parseBooleanText(word)).toBe(true);
    for (const word of ['no', 'False', '', 'unchecked', 'off'])
      expect(parseBooleanText(word)).toBe(false);
    expect(parseBooleanText('1')).toBeNull();
    expect(parseBooleanText('1', { numeric: true })).toBe(true);
    expect(parseBooleanText('0', { numeric: true })).toBe(false);
    expect(parseBooleanText('maybe', { numeric: true })).toBeNull();
  });
});

describe('parseDateText', () => {
  it('reads ISO dates and times', () => {
    expect(parseDateText('2026-09-23', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('2026/9/3', ctx)).toEqual({ start: '2026-09-03' });
    expect(parseDateText('2026-09-23 14:30', ny)).toEqual({
      start: '2026-09-23T18:30:00.000Z',
      includeTime: true,
    });
    expect(parseDateText('2026-09-23T14:30:00Z', ny)).toEqual({
      start: '2026-09-23T14:30:00.000Z',
      includeTime: true,
    });
    expect(parseDateText('2026-09-23T14:30:00.123+0200', ctx)).toEqual({
      start: '2026-09-23T12:30:00.123Z',
      includeTime: true,
    });
    expect(parseDateText('2026-09-23 9:05', ctx)?.start).toBe('2026-09-23T09:05:00.000Z');
    expect(parseDateText('2026-02-30', ctx)).toBeNull();
    expect(parseDateText('2026-09-23 25:00', ctx)).toBeNull();
    expect(parseDateText('2026-09-23T25:00:00Z', ctx)).toBeNull();
  });

  it('reads numeric dates, month-first unless told otherwise', () => {
    expect(parseDateText('9/23/2026', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('23/09/2026', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('03/04/2026', ctx)).toEqual({ start: '2026-03-04' });
    expect(parseDateText('03/04/2026', ctx, { dayFirst: true })).toEqual({ start: '2026-04-03' });
    expect(parseDateText('23.09.26', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('1/2/99', ctx)).toEqual({ start: '1999-01-02' });
    expect(parseDateText('13/13/2026', ctx)).toBeNull();
  });

  it('reads month names and trailing times', () => {
    expect(parseDateText('Sep 23, 2026', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('September 23 2026', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('23 Sept. 2026', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('Wednesday, September 23rd, 2026', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('Sep 23, 2026 2:30 PM', ny)).toEqual({
      start: '2026-09-23T18:30:00.000Z',
      includeTime: true,
    });
    expect(parseDateText('Sep 23, 2026 12 am', ctx)?.start).toBe('2026-09-23T00:00:00.000Z');
    expect(parseDateText('Sep 23, 2026 12:15 p.m.', ctx)?.start).toBe('2026-09-23T12:15:00.000Z');
    expect(parseDateText('9/23/2026 14:05:30', ctx)?.start).toBe('2026-09-23T14:05:00.000Z');
    expect(parseDateText('Sep 31, 2026', ctx)).toBeNull();
    expect(parseDateText('Smarch 3, 2026', ctx)).toBeNull();
    expect(parseDateText('Sep 23, 2026 13 pm', ctx)).toBeNull();
    expect(parseDateText('Sep 23, 2026 10:75', ctx)).toBeNull();
    expect(parseDateText('soon', ctx)).toBeNull();
    expect(parseDateText('', ctx)).toBeNull();
  });

  it('reads ranges', () => {
    expect(parseDateText('2026-09-23 → 2026-09-30', ctx)).toEqual({
      start: '2026-09-23',
      end: '2026-09-30',
    });
    expect(parseDateText('Sep 23, 2026 to Sep 30, 2026', ctx)).toEqual({
      start: '2026-09-23',
      end: '2026-09-30',
    });
    expect(parseDateText('2026-09-23 – 2026-09-23', ctx)).toEqual({ start: '2026-09-23' });
    expect(parseDateText('2026-09-23 10:00 → 2026-09-23 12:00', ctx)).toEqual({
      start: '2026-09-23T10:00:00.000Z',
      end: '2026-09-23T12:00:00.000Z',
      includeTime: true,
    });
    expect(parseDateText('2026-09-23 → 2026-09-24 08:00', ctx)).toEqual({
      start: '2026-09-23T00:00:00.000Z',
      end: '2026-09-24T08:00:00.000Z',
      includeTime: true,
    });
    expect(parseDateText('2026-09-23 10:00 → 2026-09-23 10:00', ctx)).toEqual({
      start: '2026-09-23T10:00:00.000Z',
      includeTime: true,
    });
    expect(parseDateText('2026-09-30 → 2026-09-23', ctx)).toBeNull();
    expect(parseDateText('2026-09-30 12:00 → 2026-09-30 10:00', ctx)).toBeNull();
    expect(parseDateText('2026-09-01 → 2026-09-02 → 2026-09-03', ctx)).toBeNull();
    expect(parseDateText('2026-09-01 → never', ctx)).toBeNull();
  });
});

describe('helpers', () => {
  it('detects emails and URLs and splits names', () => {
    expect(looksLikeEmail('ada@example.com')).toBe(true);
    expect(looksLikeEmail('ada@example')).toBe(false);
    expect(looksLikeUrl('https://example.com/a')).toBe(true);
    expect(looksLikeUrl('www.example.com')).toBe(true);
    expect(looksLikeUrl('example')).toBe(false);
    expect(splitNames(' Design, research ,design,, Ops ')).toEqual(['Design', 'research', 'Ops']);
  });

  it('detects emails and URLs exactly as the regexes they replace did', () => {
    // The former patterns: two overlapping runs each, which took seconds on a long cell.
    const email = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
    const url = /^(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+)$/i;
    const unit = fc.constantFrom(
      'a',
      'Z',
      '.',
      '@',
      ' ',
      '/',
      ':',
      '"',
      '\\',
      'www.',
      'WWW.',
      'https://',
      'http://',
      'HTTP://',
    );
    fc.assert(
      fc.property(fc.string({ unit, maxLength: 12 }), (text) => {
        expect(looksLikeEmail(text)).toBe(email.test(text.trim()));
        expect(looksLikeUrl(text)).toBe(url.test(text.trim()));
      }),
      { numRuns: 3000 },
    );
  });
});

describe('long, hostile cells', () => {
  it('reads currencies at the end and ranges with any spacing, as before', () => {
    expect(parseNumberText('12 €')).toEqual({ value: 12, percent: false, currency: 'EUR' });
    expect(parseNumberText('1,200   EUR')).toEqual({
      value: 1200,
      percent: false,
      currency: 'EUR',
    });
    expect(parseNumberText('12$')).toEqual({ value: 12, percent: false, currency: 'USD' });
    expect(parseNumberText('12EUR')).toBeNull();
    expect(parseNumberText('EUR')).toBeNull();
    expect(parseNumberText('1.')?.value).toBe(1);
    expect(parseDateText('2026-09-01    to    2026-09-03', ctx)).toEqual(
      parseDateText('2026-09-01 → 2026-09-03', ctx),
    );
  });

  it('are rejected in linear time (CSV cells and filters are untrusted text)', () => {
    // Each of these took seconds with the former regexes (CodeQL js/polynomial-redos).
    const cells = [
      `1${' '.repeat(50_000)}x`,
      `${'0'.repeat(50_000)}x`,
      `a${' '.repeat(50_000)}b`,
      `www.!.${'!.'.repeat(25_000)} x`,
      `a@${'b.'.repeat(25_000)} x`,
    ];
    const started = performance.now();
    for (const cell of cells) {
      expect(parseNumberText(cell)).toBeNull();
      expect(parseDateText(cell, ctx)).toBeNull();
      expect(looksLikeUrl(cell)).toBe(false);
      expect(looksLikeEmail(cell)).toBe(false);
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

describe('parseCellText', () => {
  it('parses text for every property type', () => {
    expect(parseCellText('  Moon\nlanding ', property('t', 'title'), ctx)).toEqual({
      kind: 'title',
      title: 'Moon landing',
    });
    expect(parseCellText('x', property('c', 'createdTime'), ctx)).toEqual({ kind: 'readOnly' });
    expect(parseCellText('x', property('f', 'formula'), ctx)).toEqual({ kind: 'readOnly' });
    expect(parseCellText('  ', property('n', 'number'), ctx)).toEqual({
      kind: 'value',
      value: null,
    });
    expect(parseCellText(' two\nlines ', property('x', 'text'), ctx)).toEqual({
      kind: 'value',
      value: ' two\nlines ',
    });
    expect(parseCellText('x'.repeat(100_001), property('x', 'text'), ctx)).toEqual({
      kind: 'invalid',
    });
    expect(parseCellText(' https://a.b ', property('u', 'url'), ctx)).toEqual({
      kind: 'value',
      value: 'https://a.b',
    });
    expect(parseCellText('u'.repeat(5000), property('u', 'url'), ctx)).toEqual({ kind: 'invalid' });
    expect(parseCellText(' a@b.co ', property('e', 'email'), ctx)).toEqual({
      kind: 'value',
      value: 'a@b.co',
    });
    expect(parseCellText('e'.repeat(400), property('e', 'email'), ctx)).toEqual({
      kind: 'invalid',
    });
    expect(parseCellText('1,5', property('n', 'number'), ctx)).toEqual({
      kind: 'value',
      value: 1.5,
    });
    expect(parseCellText('many', property('n', 'number'), ctx)).toEqual({ kind: 'invalid' });
    expect(parseCellText('yes', property('c', 'checkbox'), ctx)).toEqual({
      kind: 'value',
      value: true,
    });
    expect(parseCellText('0', property('c', 'checkbox'), ctx)).toEqual({
      kind: 'value',
      value: false,
    });
    expect(parseCellText('perhaps', property('c', 'checkbox'), ctx)).toEqual({ kind: 'invalid' });
    expect(parseCellText('2026-09-23', property('d', 'date'), ctx)).toEqual({
      kind: 'value',
      value: { start: '2026-09-23' },
    });
    expect(parseCellText('someday', property('d', 'date'), ctx)).toEqual({ kind: 'invalid' });
    expect(parseCellText(' In progress ', property('s', 'select'), ctx)).toEqual({
      kind: 'options',
      names: ['In progress'],
    });
    expect(parseCellText('a, b, A', property('m', 'multiSelect'), ctx)).toEqual({
      kind: 'options',
      names: ['a', 'b'],
    });
    expect(parseCellText('Moon, Mars', property('r', 'relation'), ctx)).toEqual({
      kind: 'pages',
      titles: ['Moon', 'Mars'],
    });
  });

  it('reads numbers in percent columns as percentage points', () => {
    const percent = property('p', 'number', {
      number: { format: 'percent', currency: 'USD', precision: null },
    });
    expect(parseCellText('25', percent, ctx)).toEqual({ kind: 'value', value: 0.25 });
    expect(parseCellText('25%', percent, ctx)).toEqual({ kind: 'value', value: 0.25 });
  });
});
