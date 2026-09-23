import {
  STORED_PROPERTY_TYPES,
  getCellValue,
  isDateOnlyString,
  isDateTimeString,
  validatePropertyValue,
  type JsonValue,
  type ResolvedRow,
} from '@tessera/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { property, row } from '../test/fixtures';
import {
  isDateOnly,
  isDateTime,
  isValidStoredValue,
  readCell,
  readChecked,
  readDateValue,
  readIds,
  readNumber,
  readString,
} from './cells';

const idArb = fc.stringMatching(/^[A-Za-z0-9_-]{1,8}$/);
const dayArb = fc
  .date({
    min: new Date('1900-01-01T00:00:00Z'),
    max: new Date('2200-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString().slice(0, 10));
const instantArb = fc
  .date({
    min: new Date('1900-01-01T00:00:00Z'),
    max: new Date('2200-12-31T00:00:00Z'),
    noInvalidDate: true,
  })
  .map((date) => date.toISOString());

/** Values shaped like every stored type, plus near misses and junk. */
const valueArb: fc.Arbitrary<JsonValue> = fc.oneof(
  fc.string(),
  fc.constantFrom('x'.repeat(100_000), 'x'.repeat(100_001), 'u'.repeat(4097), 'e'.repeat(321)),
  idArb,
  fc.double(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(idArb, { maxLength: 5 }),
  fc.array(fc.oneof(idArb, fc.integer()), { maxLength: 4 }),
  fc.record({ start: dayArb }),
  fc.record({ start: dayArb, end: fc.option(dayArb, { nil: null }) }),
  fc.record({ start: instantArb, end: fc.option(instantArb), includeTime: fc.constant(true) }),
  fc.record({
    start: dayArb,
    includeTime: fc.boolean(),
    timeZone: fc.option(fc.string({ maxLength: 70 })),
  }),
  fc.record({ start: fc.string(), extra: fc.integer() }),
  fc.jsonValue() as fc.Arbitrary<JsonValue>,
);

function resolved(values: Record<string, JsonValue>): ResolvedRow {
  return { ...row('Row', values), trashed: false, missingPage: false };
}

describe('isDateOnly and isDateTime', () => {
  const pad = (value: number, length: number) => String(value).padStart(length, '0');
  const looseDay = fc
    .tuple(
      fc.integer({ min: 0, max: 9999 }),
      fc.integer({ min: 0, max: 13 }),
      fc.integer({ min: 0, max: 32 }),
    )
    .map(([y, m, d]) => `${pad(y, 4)}-${pad(m, 2)}-${pad(d, 2)}`);
  const looseTime = fc
    .tuple(
      looseDay,
      fc.integer({ min: 0, max: 25 }),
      fc.integer({ min: 0, max: 61 }),
      fc.constantFrom('Z', '+02:00', '-11:30', '+25:00', ''),
    )
    .map(([day, h, m, zone]) => `${day}T${pad(h, 2)}:${pad(m, 2)}:00${zone}`);

  it('agrees with core for any day-shaped string, including years 0–99 and impossible days', () => {
    fc.assert(
      fc.property(fc.oneof(looseDay, fc.string()), (text) => {
        expect(isDateOnly(text)).toBe(isDateOnlyString(text));
      }),
      { numRuns: 5000 },
    );
    expect(isDateOnly('0050-01-01')).toBe(false);
    expect(isDateOnly('2024-02-29')).toBe(true);
    expect(isDateOnly('2100-02-29')).toBe(false);
    expect(isDateOnly('2000-02-29')).toBe(true);
  });

  it('agrees with core for date-times', () => {
    fc.assert(
      fc.property(fc.oneof(looseTime, fc.string()), (text) => {
        expect(isDateTime(text)).toBe(isDateTimeString(text));
      }),
      { numRuns: 5000 },
    );
  });
});

describe('isValidStoredValue', () => {
  it('agrees with core validatePropertyValue for every stored type', () => {
    fc.assert(
      fc.property(valueArb, (value) => {
        for (const type of STORED_PROPERTY_TYPES) {
          expect(isValidStoredValue(type, value)).toBe(validatePropertyValue(type, value).success);
        }
      }),
      { numRuns: 3000 },
    );
  });

  it('checks the edges core checks', () => {
    expect(isValidStoredValue('text', 'x'.repeat(100_000))).toBe(true);
    expect(isValidStoredValue('text', 'x'.repeat(100_001))).toBe(false);
    expect(isValidStoredValue('number', Number.NaN)).toBe(false);
    expect(isValidStoredValue('number', Infinity)).toBe(false);
    expect(isValidStoredValue('select', 'has space')).toBe(false);
    expect(isValidStoredValue('multiSelect', ['a', 'a'])).toBe(false);
    expect(isValidStoredValue('relation', ['a', 'b'])).toBe(true);
    expect(isValidStoredValue('url', 'u'.repeat(4097))).toBe(false);
    expect(isValidStoredValue('email', 'e'.repeat(321))).toBe(false);
    expect(isValidStoredValue('checkbox', 'true')).toBe(false);
    expect(isValidStoredValue('date', { start: '2026-02-30' })).toBe(false);
    expect(isValidStoredValue('date', { start: '2026-09-23', end: '2026-09-22' })).toBe(false);
    expect(
      isValidStoredValue('date', {
        start: '2026-09-23T10:00:00Z',
        end: '2026-09-23T09:00:00Z',
        includeTime: true,
      }),
    ).toBe(false);
    expect(isValidStoredValue('date', { start: '2026-09-23', timeZone: '' })).toBe(false);
    expect(isValidStoredValue('date', { start: '2026-09-23', includeTime: 'yes' })).toBe(false);
    expect(isValidStoredValue('date', ['2026-09-23'])).toBe(false);
  });
});

describe('readCell', () => {
  const props = [
    property('title', 'title'),
    property('text', 'text'),
    property('number', 'number'),
    property('select', 'select'),
    property('multi', 'multiSelect'),
    property('date', 'date'),
    property('check', 'checkbox'),
    property('url', 'url'),
    property('email', 'email'),
    property('rel', 'relation'),
    property('created', 'createdTime'),
    property('updated', 'updatedTime'),
    property('formula', 'formula'),
  ];

  it('returns exactly what core getCellValue returns', () => {
    fc.assert(
      fc.property(fc.dictionary(fc.constantFrom(...props.map((p) => p.id)), valueArb), (values) => {
        const entry = resolved(values);
        for (const prop of props) expect(readCell(entry, prop)).toEqual(getCellValue(entry, prop));
      }),
      { numRuns: 1500 },
    );
  });

  it('strips unknown keys from dates like zod does', () => {
    const date = property('date', 'date');
    const entry = row('A', { date: { start: '2026-09-23', end: null, junk: 1 } });
    expect(readCell(entry, date)).toEqual({ start: '2026-09-23', end: null });
    expect(
      readDateValue({
        start: '2026-09-23T10:00:00+02:00',
        includeTime: true,
        timeZone: 'Europe/Paris',
      }),
    ).toEqual({
      start: '2026-09-23T10:00:00+02:00',
      includeTime: true,
      timeZone: 'Europe/Paris',
    });
  });

  it('has typed helpers', () => {
    const entry = row('Moon', {
      text: 'hi',
      number: 3,
      select: 'a',
      multi: ['a', 'b'],
      check: true,
    });
    const [title, text, number, select, multi, , check] = props;
    if (!title || !text || !number || !select || !multi || !check) throw new Error('fixtures');
    expect(readString(entry, title)).toBe('Moon');
    expect(readString(entry, number)).toBeNull();
    expect(readNumber(entry, number)).toBe(3);
    expect(readNumber(entry, text)).toBeNull();
    expect(readIds(entry, select)).toEqual(['a']);
    expect(readIds(entry, multi)).toEqual(['a', 'b']);
    expect(readIds(entry, text)).toEqual(['hi']);
    expect(readIds(entry, number)).toEqual([]);
    expect(readChecked(entry, check)).toBe(true);
    expect(readChecked(row('B'), check)).toBe(false);
  });
});
