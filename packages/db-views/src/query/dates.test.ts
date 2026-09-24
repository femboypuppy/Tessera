import { RELATIVE_DATE_RANGES } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dateSpan,
  dayKeyOfInstant,
  dayKeyOfUtc,
  dayOfWeek,
  daysBetween,
  endOfMonth,
  instantSpan,
  isoWeekKey,
  isoWeekStart,
  parseDayKey,
  relativeRange,
  resolveDateOperand,
  resolveRangeOperand,
  startOfDayInstant,
  startOfMonth,
  startOfWeek,
  timeOfInstant,
  todayKey,
  zoneOffset,
  zonedTimeToInstant,
} from './dates';

const HOUR = 3_600_000;

describe('calendar arithmetic', () => {
  it('adds days and months, clamping month ends', () => {
    expect(addDays('2026-09-23', 10)).toBe('2026-10-03');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
    expect(addMonths('0100-03-01', -1)).toBe('0100-02-01');
    expect(daysBetween('2026-09-23', '2026-10-03')).toBe(10);
    expect(daysBetween('2026-10-03', '2026-09-23')).toBe(-10);
  });

  it('knows weekdays, weeks and months', () => {
    expect(dayOfWeek('2026-09-23')).toBe(3);
    expect(startOfWeek('2026-09-23', 1)).toBe('2026-09-21');
    expect(startOfWeek('2026-09-23', 0)).toBe('2026-09-20');
    expect(startOfWeek('2026-09-20', 1)).toBe('2026-09-14');
    expect(startOfMonth('2026-09-23')).toBe('2026-09-01');
    expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
    expect(endOfMonth('2026-12-10')).toBe('2026-12-31');
  });

  it('computes ISO weeks, including year boundaries', () => {
    expect(isoWeekKey('2026-09-23')).toBe('2026-W39');
    expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
    expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
    expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
    expect(isoWeekStart('2026-W39')).toBe('2026-09-21');
    expect(isoWeekStart('2020-W53')).toBe('2020-12-28');
    expect(isoWeekStart('nope')).toBeNull();
  });

  it('parses and prints day keys', () => {
    expect(parseDayKey('2026-09-23')).toEqual({ year: 2026, month: 9, day: 23 });
    expect(parseDayKey('2026-9-23')).toBeNull();
    expect(dayKeyOfUtc(Date.UTC(2026, 8, 23, 23, 59))).toBe('2026-09-23');
    expect(() => addDays('garbage', 1)).toThrow(RangeError);
    expect(() => addMonths('garbage', 1)).toThrow(RangeError);
  });
});

describe('time zones', () => {
  it('computes offsets, including half hours and DST', () => {
    expect(zoneOffset(Date.UTC(2026, 6, 1), 'America/New_York')).toBe(-4 * HOUR);
    expect(zoneOffset(Date.UTC(2026, 0, 1), 'America/New_York')).toBe(-5 * HOUR);
    expect(zoneOffset(Date.UTC(2026, 0, 1), 'Asia/Kolkata')).toBe(5.5 * HOUR);
    expect(zoneOffset(Date.UTC(2026, 0, 1), 'Australia/Lord_Howe')).toBe(11 * HOUR);
    expect(zoneOffset(Date.UTC(2026, 6, 1), 'Australia/Lord_Howe')).toBe(10.5 * HOUR);
    expect(zoneOffset(Date.UTC(2026, 6, 1), 'UTC')).toBe(0);
    // Cached per quarter hour: asking twice gives the same answer.
    expect(zoneOffset(Date.UTC(2026, 6, 1, 0, 7), 'America/New_York')).toBe(-4 * HOUR);
  });

  it('handles very old instants (local mean time, BC years)', () => {
    expect(dayKeyOfInstant(Date.UTC(1850, 5, 1, 12), 'Europe/Paris')).toBe('1850-06-01');
    const bc = new Date(0);
    bc.setUTCFullYear(-5, 0, 1);
    expect(typeof zoneOffset(bc.getTime(), 'Europe/Paris')).toBe('number');
  });

  it('finds the calendar day of an instant in the viewer zone', () => {
    const instant = Date.UTC(2026, 8, 23, 2, 30);
    expect(dayKeyOfInstant(instant, 'UTC')).toBe('2026-09-23');
    expect(dayKeyOfInstant(instant, 'America/Los_Angeles')).toBe('2026-09-22');
    expect(dayKeyOfInstant(Date.UTC(2026, 8, 23, 20), 'Asia/Tokyo')).toBe('2026-09-24');
    expect(timeOfInstant(instant, 'Asia/Kolkata')).toEqual({ hour: 8, minute: 0 });
    expect(todayKey(instant, 'America/Los_Angeles')).toBe('2026-09-22');
  });

  it('finds where a day starts, even when midnight is skipped', () => {
    expect(startOfDayInstant('2026-09-23', 'UTC')).toBe(Date.UTC(2026, 8, 23));
    expect(startOfDayInstant('2026-09-23', 'America/New_York')).toBe(Date.UTC(2026, 8, 23, 4));
    expect(startOfDayInstant('2026-09-23', 'Asia/Kolkata')).toBe(Date.UTC(2026, 8, 22, 18, 30));
    // São Paulo skipped from 00:00 to 01:00 on 2018-11-04: that day began at 01:00 (-02:00).
    expect(startOfDayInstant('2018-11-04', 'America/Sao_Paulo')).toBe(Date.UTC(2018, 10, 4, 3));
    // Cached.
    expect(startOfDayInstant('2018-11-04', 'America/Sao_Paulo')).toBe(Date.UTC(2018, 10, 4, 3));
  });

  it('converts wall-clock times across DST gaps and overlaps', () => {
    expect(zonedTimeToInstant('2026-09-23', 14, 30, 'America/New_York')).toBe(
      Date.UTC(2026, 8, 23, 18, 30),
    );
    // Gap: 02:30 does not exist on 2026-03-08 in New York; it moves to 03:30 EDT.
    expect(zonedTimeToInstant('2026-03-08', 2, 30, 'America/New_York')).toBe(
      Date.UTC(2026, 2, 8, 7, 30),
    );
    // Overlap: 01:30 happens twice on 2026-11-01; the earlier (EDT) wins.
    expect(zonedTimeToInstant('2026-11-01', 1, 30, 'America/New_York')).toBe(
      Date.UTC(2026, 10, 1, 5, 30),
    );
    expect(zonedTimeToInstant('2026-10-25', 2, 30, 'Europe/Berlin')).toBe(
      Date.UTC(2026, 9, 25, 0, 30),
    );
    expect(zonedTimeToInstant('2026-03-29', 2, 30, 'Europe/Berlin')).toBe(
      Date.UTC(2026, 2, 29, 1, 30),
    );
  });
});

describe('operands and ranges', () => {
  const today = '2026-09-23';

  it('resolves single-day operands', () => {
    expect(resolveDateOperand({ kind: 'exact', date: '2026-01-02' }, today)).toBe('2026-01-02');
    expect(resolveDateOperand({ kind: 'exact', date: 'soon' }, today)).toBeNull();
    expect(resolveDateOperand({ kind: 'relative', unit: 'day', amount: 0 }, today)).toBe(today);
    expect(resolveDateOperand({ kind: 'relative', unit: 'day', amount: -7 }, today)).toBe(
      '2026-09-16',
    );
    expect(resolveDateOperand({ kind: 'relative', unit: 'week', amount: 1 }, today)).toBe(
      '2026-09-30',
    );
    expect(resolveDateOperand({ kind: 'relative', unit: 'month', amount: -1 }, today)).toBe(
      '2026-08-23',
    );
    expect(resolveDateOperand({ kind: 'relative', unit: 'year', amount: 1 }, today)).toBe(
      '2027-09-23',
    );
    expect(resolveDateOperand({ kind: 'relative', unit: 'day', amount: 1.9 }, today)).toBe(
      '2026-09-24',
    );
  });

  it('resolves every relative range', () => {
    const expected: Record<string, [string, string]> = {
      today: ['2026-09-23', '2026-09-23'],
      yesterday: ['2026-09-22', '2026-09-22'],
      tomorrow: ['2026-09-24', '2026-09-24'],
      thisWeek: ['2026-09-21', '2026-09-27'],
      lastWeek: ['2026-09-14', '2026-09-20'],
      nextWeek: ['2026-09-28', '2026-10-04'],
      thisMonth: ['2026-09-01', '2026-09-30'],
      lastMonth: ['2026-08-01', '2026-08-31'],
      nextMonth: ['2026-10-01', '2026-10-31'],
      thisYear: ['2026-01-01', '2026-12-31'],
      lastYear: ['2025-01-01', '2025-12-31'],
      nextYear: ['2027-01-01', '2027-12-31'],
      past7Days: ['2026-09-17', '2026-09-23'],
      next7Days: ['2026-09-23', '2026-09-29'],
      past30Days: ['2026-08-25', '2026-09-23'],
      next30Days: ['2026-09-23', '2026-10-22'],
    };
    for (const range of RELATIVE_DATE_RANGES) {
      const [start, end] = expected[range] ?? [];
      expect(relativeRange(range, today, 1), range).toEqual({ start, end });
    }
    expect(relativeRange('thisWeek', today, 0)).toEqual({ start: '2026-09-20', end: '2026-09-26' });
  });

  it('resolves range operands', () => {
    expect(resolveRangeOperand({ kind: 'range', range: 'today' }, today, 1)).toEqual({
      start: today,
      end: today,
    });
    expect(
      resolveRangeOperand({ kind: 'between', start: '2026-10-05', end: '2026-10-01' }, today, 1),
    ).toEqual({ start: '2026-10-01', end: '2026-10-05' });
    expect(
      resolveRangeOperand({ kind: 'between', start: 'x', end: '2026-10-01' }, today, 1),
    ).toBeNull();
  });
});

describe('value spans', () => {
  it('spans date-only values across whole days in the viewer zone', () => {
    const span = dateSpan({ start: '2026-09-23', end: '2026-09-25' }, 'America/New_York');
    expect(span).toEqual({
      startDay: '2026-09-23',
      endDay: '2026-09-25',
      startMs: Date.UTC(2026, 8, 23, 4),
      endMs: Date.UTC(2026, 8, 26, 4) - 1,
      includeTime: false,
    });
    expect(dateSpan({ start: '2026-09-23', end: null }, 'UTC').endDay).toBe('2026-09-23');
  });

  it('spans values with a time by their instants', () => {
    const span = dateSpan(
      { start: '2026-09-23T23:30:00.000Z', end: '2026-09-24T01:00:00.000Z', includeTime: true },
      'Asia/Tokyo',
    );
    expect(span.startDay).toBe('2026-09-24');
    expect(span.endDay).toBe('2026-09-24');
    expect(span.startMs).toBe(Date.UTC(2026, 8, 23, 23, 30));
    expect(dateSpan({ start: '2026-09-23T10:00:00Z', includeTime: true }, 'UTC').endMs).toBe(
      Date.UTC(2026, 8, 23, 10),
    );
    expect(instantSpan(Date.UTC(2026, 8, 23, 1), 'America/New_York').startDay).toBe('2026-09-22');
  });
});
