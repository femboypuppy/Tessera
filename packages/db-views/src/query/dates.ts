import type { DateOperand, DateRangeOperand, DateValue, RelativeDateRange } from '@tessera/core';

/*
 * Calendar-day arithmetic in the viewer's time zone. Filters compare dates by calendar day in the
 * viewer's zone (SPEC 4.5), so every date becomes either a day key (`YYYY-MM-DD`, compared as
 * strings) or an instant (epoch ms). Date-only values are days everywhere; values with a time are
 * instants whose day depends on the viewer's zone.
 */

/** A calendar day, `YYYY-MM-DD`. Keys compare correctly as strings. */
export type DayKey = string;

export const DAY_MS = 86_400_000;
const QUARTER_HOUR_MS = 900_000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad(value: number, length: number): string {
  return String(Math.abs(value)).padStart(length, '0');
}

/** The day key of a UTC timestamp's UTC date. */
export function dayKeyOfUtc(ms: number): DayKey {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/** Splits a day key into numbers (month is 1-based). Invalid keys return null. */
export function parseDayKey(key: string): { year: number; month: number; day: number } | null {
  const match = DAY_KEY.exec(key);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** UTC midnight of a calendar date (`Date.UTC` would read years 0–99 as 1900–1999). */
function utcMidnight(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date.getTime();
}

function utcOfDay(key: DayKey): number {
  const parts = parseDayKey(key);
  if (!parts) throw new RangeError(`Invalid day "${key}"`);
  return utcMidnight(parts.year, parts.month - 1, parts.day);
}

/** Adds (or subtracts) whole days. */
export function addDays(key: DayKey, days: number): DayKey {
  return dayKeyOfUtc(utcOfDay(key) + days * DAY_MS);
}

/** Adds months, clamping the day to the target month's length (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(key: DayKey, months: number): DayKey {
  const parts = parseDayKey(key);
  if (!parts) throw new RangeError(`Invalid day "${key}"`);
  const first = new Date(utcMidnight(parts.year, parts.month - 1 + months, 1));
  const lastDay = new Date(
    utcMidnight(first.getUTCFullYear(), first.getUTCMonth() + 1, 0),
  ).getUTCDate();
  first.setUTCDate(Math.min(parts.day, lastDay));
  return dayKeyOfUtc(first.getTime());
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: DayKey, to: DayKey): number {
  return Math.round((utcOfDay(to) - utcOfDay(from)) / DAY_MS);
}

/** Day of the week, 0 = Sunday. */
export function dayOfWeek(key: DayKey): number {
  return new Date(utcOfDay(key)).getUTCDay();
}

/** The first day of the week containing `key`. */
export function startOfWeek(key: DayKey, weekStartsOn: 0 | 1): DayKey {
  return addDays(key, -((dayOfWeek(key) - weekStartsOn + 7) % 7));
}

/** The first day of the month containing `key`. */
export function startOfMonth(key: DayKey): DayKey {
  return `${key.slice(0, 8)}01`;
}

/** The last day of the month containing `key`. */
export function endOfMonth(key: DayKey): DayKey {
  return addDays(addMonths(startOfMonth(key), 1), -1);
}

/** ISO 8601 week of a day, as `YYYY-Www` (weeks start on Monday; week 1 holds January 4). */
export function isoWeekKey(key: DayKey): string {
  const weekday = (dayOfWeek(key) + 6) % 7; // Monday = 0
  const thursday = addDays(key, 3 - weekday);
  const year = Number(thursday.slice(0, 4));
  const week = Math.floor(daysBetween(`${pad(year, 4)}-01-01`, thursday) / 7) + 1;
  return `${pad(year, 4)}-W${pad(week, 2)}`;
}

/** The Monday that starts an ISO week key (`2026-W39` → `2026-09-21`). */
export function isoWeekStart(weekKey: string): DayKey | null {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey);
  if (!match) return null;
  const jan4 = `${match[1]}-01-04`;
  const firstMonday = addDays(jan4, -((dayOfWeek(jan4) + 6) % 7));
  return addDays(firstMonday, (Number(match[2]) - 1) * 7);
}

// ---------------------------------------------------------------------------------------------
// Time zones
// ---------------------------------------------------------------------------------------------

const partFormatters = new Map<string, Intl.DateTimeFormat>();
const offsetCache = new Map<string, Map<number, number>>();
const dayStartCache = new Map<string, Map<DayKey, number>>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      era: 'short',
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

function computeOffset(ms: number, timeZone: string): number {
  const fields: Record<string, number> = {};
  let bc = false;
  for (const part of partsFormatter(timeZone).formatToParts(ms)) {
    if (part.type === 'era') bc = part.value.startsWith('B');
    else if (part.type !== 'literal') fields[part.type] = Number(part.value);
  }
  const year = bc ? 1 - (fields.year ?? 0) : (fields.year ?? 1970);
  const asUtc = new Date(0);
  asUtc.setUTCFullYear(year, (fields.month ?? 1) - 1, fields.day ?? 1);
  asUtc.setUTCHours(fields.hour ?? 0, fields.minute ?? 0, fields.second ?? 0, 0);
  return asUtc.getTime() - Math.floor(ms / 1000) * 1000;
}

/**
 * The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). Zone
 * offsets are multiples of 15 minutes and change only on quarter-hour UTC boundaries, so results
 * are cached per quarter hour.
 */
export function zoneOffset(ms: number, timeZone: string): number {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return 0;
  let cache = offsetCache.get(timeZone);
  if (!cache) {
    cache = new Map();
    offsetCache.set(timeZone, cache);
  }
  const bucket = Math.floor(ms / QUARTER_HOUR_MS);
  let offset = cache.get(bucket);
  if (offset === undefined) {
    if (cache.size > 100_000) cache.clear();
    offset = computeOffset(bucket * QUARTER_HOUR_MS, timeZone);
    cache.set(bucket, offset);
  }
  return offset;
}

/** The calendar day of an instant in a time zone. */
export function dayKeyOfInstant(ms: number, timeZone: string): DayKey {
  return dayKeyOfUtc(ms + zoneOffset(ms, timeZone));
}

/** Wall-clock hours and minutes of an instant in a time zone. */
export function timeOfInstant(ms: number, timeZone: string): { hour: number; minute: number } {
  const local = new Date(ms + zoneOffset(ms, timeZone));
  return { hour: local.getUTCHours(), minute: local.getUTCMinutes() };
}

/**
 * The first instant of a calendar day in a time zone. Usually local midnight; when midnight does
 * not exist (a DST jump at 00:00), the day starts at the jump.
 */
export function startOfDayInstant(key: DayKey, timeZone: string): number {
  let cache = dayStartCache.get(timeZone);
  if (!cache) {
    cache = new Map();
    dayStartCache.set(timeZone, cache);
  }
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  const base = utcOfDay(key);
  let start = base - zoneOffset(base, timeZone);
  start = base - zoneOffset(start, timeZone);
  if (dayKeyOfInstant(start, timeZone) !== key || dayKeyOfInstant(start - 1, timeZone) >= key) {
    // A DST transition at midnight: find the first minute whose local day is `key`.
    let low = base - 18 * 3_600_000;
    let high = base + 18 * 3_600_000;
    while (high - low > 60_000) {
      const mid = low + Math.floor((high - low) / 120_000) * 60_000;
      if (dayKeyOfInstant(mid, timeZone) >= key) high = mid;
      else low = mid;
    }
    start = high;
  }
  if (cache.size > 50_000) cache.clear();
  cache.set(key, start);
  return start;
}

/**
 * Converts a wall-clock time on a day in a time zone to an instant. Times that do not exist (a DST
 * gap) move forward by the gap (02:30 becomes 03:30); ambiguous times (a DST overlap) pick the
 * earlier instant.
 */
export function zonedTimeToInstant(
  key: DayKey,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const local = utcOfDay(key) + (hour * 60 + minute) * 60_000;
  // Candidates with the offsets in force before and after any transition near this time.
  const before = local - zoneOffset(local - DAY_MS / 2, timeZone);
  const after = local - zoneOffset(local + DAY_MS / 2, timeZone);
  const valid = [before, after].filter(
    (instant) => instant + zoneOffset(instant, timeZone) === local,
  );
  // Both valid: an overlap, take the earlier one. Neither: a gap, the old offset moves it forward.
  return valid.length > 0 ? Math.min(...valid) : before;
}

// ---------------------------------------------------------------------------------------------
// Operands and ranges
// ---------------------------------------------------------------------------------------------

/** An inclusive range of calendar days. */
export interface DayRange {
  start: DayKey;
  end: DayKey;
}

/** Today in the viewer's zone. */
export function todayKey(now: number, timeZone: string): DayKey {
  return dayKeyOfInstant(now, timeZone);
}

/** Resolves a filter's single-date operand to a calendar day, or null when it is malformed. */
export function resolveDateOperand(operand: DateOperand, today: DayKey): DayKey | null {
  if (operand.kind === 'exact') return parseDayKey(operand.date) ? operand.date : null;
  const amount = Math.trunc(operand.amount);
  switch (operand.unit) {
    case 'day':
      return addDays(today, amount);
    case 'week':
      return addDays(today, amount * 7);
    case 'month':
      return addMonths(today, amount);
    case 'year':
      return addMonths(today, amount * 12);
  }
}

/**
 * The days a relative range covers, relative to `today`. `past7Days` is the seven days ending
 * today, `next7Days` the seven days starting today (30-day ranges likewise); weeks start on
 * `weekStartsOn`.
 */
export function relativeRange(
  range: RelativeDateRange,
  today: DayKey,
  weekStartsOn: 0 | 1,
): DayRange {
  const week = (offset: number): DayRange => {
    const start = addDays(startOfWeek(today, weekStartsOn), offset * 7);
    return { start, end: addDays(start, 6) };
  };
  const month = (offset: number): DayRange => {
    const start = addMonths(startOfMonth(today), offset);
    return { start, end: endOfMonth(start) };
  };
  const year = (offset: number): DayRange => {
    const y = pad(Number(today.slice(0, 4)) + offset, 4);
    return { start: `${y}-01-01`, end: `${y}-12-31` };
  };
  switch (range) {
    case 'today':
      return { start: today, end: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { start: day, end: day };
    }
    case 'tomorrow': {
      const day = addDays(today, 1);
      return { start: day, end: day };
    }
    case 'thisWeek':
      return week(0);
    case 'lastWeek':
      return week(-1);
    case 'nextWeek':
      return week(1);
    case 'thisMonth':
      return month(0);
    case 'lastMonth':
      return month(-1);
    case 'nextMonth':
      return month(1);
    case 'thisYear':
      return year(0);
    case 'lastYear':
      return year(-1);
    case 'nextYear':
      return year(1);
    case 'past7Days':
      return { start: addDays(today, -6), end: today };
    case 'next7Days':
      return { start: today, end: addDays(today, 6) };
    case 'past30Days':
      return { start: addDays(today, -29), end: today };
    case 'next30Days':
      return { start: today, end: addDays(today, 29) };
  }
}

/** Resolves an `isWithin` operand to an inclusive day range, or null when it is malformed. */
export function resolveRangeOperand(
  operand: DateRangeOperand,
  today: DayKey,
  weekStartsOn: 0 | 1,
): DayRange | null {
  if (operand.kind === 'range') return relativeRange(operand.range, today, weekStartsOn);
  if (!parseDayKey(operand.start) || !parseDayKey(operand.end)) return null;
  return operand.start <= operand.end
    ? { start: operand.start, end: operand.end }
    : { start: operand.end, end: operand.start };
}

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/** Where a date value sits in time, both as days (viewer's zone) and instants. */
export interface DateSpan {
  startDay: DayKey;
  endDay: DayKey;
  /** First instant covered. */
  startMs: number;
  /** Last instant covered (inclusive). */
  endMs: number;
  includeTime: boolean;
}

/** The span of a (valid) date value in the viewer's zone. */
export function dateSpan(value: DateValue, timeZone: string): DateSpan {
  if (value.includeTime) {
    const startMs = Date.parse(value.start);
    const endMs = value.end ? Date.parse(value.end) : startMs;
    return {
      startDay: dayKeyOfInstant(startMs, timeZone),
      endDay: dayKeyOfInstant(endMs, timeZone),
      startMs,
      endMs,
      includeTime: true,
    };
  }
  const endDay = value.end ?? value.start;
  return {
    startDay: value.start,
    endDay,
    startMs: startOfDayInstant(value.start, timeZone),
    endMs: startOfDayInstant(addDays(endDay, 1), timeZone) - 1,
    includeTime: false,
  };
}

/** The span of an instant (created and updated times). */
export function instantSpan(ms: number, timeZone: string): DateSpan {
  const day = dayKeyOfInstant(ms, timeZone);
  return { startDay: day, endDay: day, startMs: ms, endMs: ms, includeTime: true };
}
