import {
  MAX_TEXT_VALUE_LENGTH,
  MAX_URL_LENGTH,
  isDateOnlyString,
  type DateValue,
  type JsonValue,
  type PropertyDefinition,
} from '@tessera/core';
import { zonedTimeToInstant, type DayKey } from './dates';
import type { QueryContext } from './types';

/*
 * Parsing text into property values: pasted cells, CSV imports and type conversions all go
 * through here, so "12%" or "Sep 23, 2026" mean the same thing everywhere.
 */

/** A parsed number and what its text said about the format. */
export interface ParsedNumber {
  value: number;
  /** The text ended with `%` (the value is already divided by 100). */
  percent: boolean;
  /** ISO 4217 code of a currency symbol or code in the text. */
  currency: string | null;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: 'USD',
  US$: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₩': 'KRW',
  CA$: 'CAD',
  A$: 'AUD',
  CHF: 'CHF',
};

const SPACES = /[\s\u00a0\u202f']/g;

let currencyCodes: ReadonlySet<string> | null = null;

/** True for ISO 4217 codes the runtime knows (`USD`, `EUR`, …). */
export function isCurrencyCode(code: string): boolean {
  if (!currencyCodes) {
    try {
      currencyCodes = new Set(Intl.supportedValuesOf('currency'));
    } catch {
      currencyCodes = new Set(['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'CHF', 'CNY', 'INR']);
    }
  }
  return currencyCodes.has(code);
}

/**
 * Parses a number written by a person or a spreadsheet: thousands separators (`1,234.5`,
 * `1.234,5`, `1 234,5`), a leading sign or accounting parentheses, `%`, and currency symbols or
 * codes (`$1,200`, `1200 EUR`). Returns null when the text is not a number.
 *
 * @example
 * parseNumberText('12.5%'); // { value: 0.125, percent: true, currency: null }
 */
export function parseNumberText(text: string): ParsedNumber | null {
  let source = text.trim();
  if (source === '') return null;
  let negative = false;
  if (/^\(.*\)$/.test(source)) {
    negative = true;
    source = source.slice(1, -1).trim();
  }
  let percent = false;
  if (source.endsWith('%')) {
    percent = true;
    source = source.slice(0, -1).trim();
  }
  let currency: string | null = null;
  const symbol = /^(-|\+)?\s*(US\$|CA\$|A\$|[$€£¥₹₩]|[A-Z]{3}(?=\s))\s*/.exec(source);
  const prefix = symbol?.[2];
  if (prefix && (CURRENCY_SYMBOLS[prefix] || isCurrencyCode(prefix))) {
    currency = CURRENCY_SYMBOLS[prefix] ?? prefix;
    source = (symbol[1] ?? '') + source.slice(symbol[0].length);
  } else {
    const suffix = /(?:\s*([$€£¥₹₩])|\s+([A-Z]{3}))$/.exec(source);
    const code = suffix?.[1] ?? suffix?.[2];
    if (suffix && code && (CURRENCY_SYMBOLS[code] || isCurrencyCode(code))) {
      currency = CURRENCY_SYMBOLS[code] ?? code;
      source = source.slice(0, -suffix[0].length);
    }
  }
  source = source.replace(SPACES, '');
  if (source.startsWith('-')) {
    negative = !negative;
    source = source.slice(1);
  } else if (source.startsWith('+')) {
    source = source.slice(1);
  }
  const lastComma = source.lastIndexOf(',');
  const lastDot = source.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Both separators: the later one is the decimal point.
    source =
      lastComma > lastDot ? source.replace(/\./g, '').replace(',', '.') : source.replace(/,/g, '');
  } else if (lastComma >= 0) {
    source = /^\d{1,3}(,\d{3})+$/.test(source) ? source.replace(/,/g, '') : source;
    if ((source.match(/,/g) ?? []).length === 1) source = source.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(source)) {
    source = source.replace(/\./g, '');
  }
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(source)) return null;
  let value = Number(source);
  if (!Number.isFinite(value)) return null;
  if (negative) value = -value;
  if (percent) value /= 100;
  return { value, percent, currency };
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'x', '✓', '✔', '☑', 'checked', 'on', 'done']);
const FALSE_WORDS = new Set(['false', 'no', 'n', '✗', '✘', '☐', 'unchecked', 'off', '']);

/**
 * Parses a checkbox. `numeric` also accepts `1` and `0` (converting from numbers, pasting); CSV
 * inference leaves it off so a column of 0s and 1s stays a number.
 */
export function parseBooleanText(
  text: string,
  options: { numeric?: boolean } = {},
): boolean | null {
  const word = text.trim().toLowerCase();
  if (TRUE_WORDS.has(word)) return true;
  if (FALSE_WORDS.has(word)) return false;
  if (options.numeric) {
    if (word === '1') return true;
    if (word === '0') return false;
  }
  return null;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

function dayKey(year: number, month: number, day: number): DayKey | null {
  const key = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isDateOnlyString(key) ? key : null;
}

function fullYear(year: string): number {
  const value = Number(year);
  if (year.length > 2) return value;
  return value < 70 ? 2000 + value : 1900 + value;
}

interface ParsedPoint {
  day: DayKey;
  /** Minutes after midnight, when the text had a time. */
  minutes: number | null;
  /** An exact instant (the text had an offset or `Z`). */
  instant: number | null;
}

const TIME = /^(\d{1,2})(?::(\d{2}))?(?::(\d{2})(?:\.\d+)?)?\s*(am|pm|a\.m\.|p\.m\.)?$/i;

function parseTime(text: string): number | null {
  const match = TIME.exec(text.trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[4]?.toLowerCase().replace(/\./g, '');
  if (!match[2] && !meridiem) return null;
  if (minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    if (meridiem === 'pm' && hour !== 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
  } else if (hour > 23) {
    return null;
  }
  return hour * 60 + minute;
}

function parsePoint(input: string, dayFirst: boolean): ParsedPoint | null {
  const text = input.trim().replace(/\s+/g, ' ');
  if (text === '') return null;

  // ISO: 2026-09-23, 2026-09-23T14:30, 2026-09-23 14:30:00.000+02:00, 2026/09/23
  const iso =
    /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(
      text,
    );
  if (iso) {
    const day = dayKey(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!day) return null;
    if (!iso[4]) return { day, minutes: null, instant: null };
    if (iso[5]) {
      const offset =
        iso[5].toUpperCase() === 'Z' ? 'Z' : iso[5].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
      const instant = Date.parse(`${day}T${iso[4].length === 4 ? `0${iso[4]}` : iso[4]}${offset}`);
      return Number.isNaN(instant) ? null : { day, minutes: null, instant };
    }
    const minutes = parseTime(iso[4]);
    return minutes === null ? null : { day, minutes, instant: null };
  }

  // Split a trailing time: "Sep 23, 2026 2:30 PM", "23/09/2026 14:30".
  let datePart = text;
  let minutes: number | null = null;
  const timeMatch =
    /[ ,]+(\d{1,2}(?::\d{2}){1,2}(?:\.\d+)?(?:\s*(?:am|pm|a\.m\.|p\.m\.))?|\d{1,2}\s*(?:am|pm|a\.m\.|p\.m\.))$/i.exec(
      text,
    );
  if (timeMatch?.[1]) {
    minutes = parseTime(timeMatch[1]);
    if (minutes === null) return null;
    datePart = text.slice(0, timeMatch.index);
  }
  datePart = datePart.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();

  // Numeric: 9/23/2026, 23.09.2026, 23-09-26
  const numeric = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(datePart);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    const year = fullYear(numeric[3] ?? '');
    const first = a > 12 ? true : b > 12 ? false : dayFirst;
    const day = first ? dayKey(year, b, a) : dayKey(year, a, b);
    return day ? { day, minutes, instant: null } : null;
  }

  // Month names: "Sep 23 2026", "September 23 2026", "23 Sep 2026", "Wednesday September 23 2026"
  const words = datePart
    .split(' ')
    .filter((word) => !/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?$/i.test(word));
  if (words.length === 3) {
    const [w1 = '', w2 = '', w3 = ''] = words;
    const monthFirst = MONTHS[w1.toLowerCase().replace(/\.$/, '')];
    const monthSecond = MONTHS[w2.toLowerCase().replace(/\.$/, '')];
    const dayOf = (word: string) => Number(word.replace(/(st|nd|rd|th)$/i, ''));
    let day: DayKey | null = null;
    if (monthFirst && /^\d{1,2}(st|nd|rd|th)?$/i.test(w2) && /^\d{4}$/.test(w3))
      day = dayKey(Number(w3), monthFirst, dayOf(w2));
    else if (monthSecond && /^\d{1,2}(st|nd|rd|th)?$/i.test(w1) && /^\d{4}$/.test(w3))
      day = dayKey(Number(w3), monthSecond, dayOf(w1));
    return day ? { day, minutes, instant: null } : null;
  }
  return null;
}

const RANGE_SEPARATOR = /\s+(?:→|->|–|—|to)\s+/i;

/**
 * Parses a date or a range (`2026-09-23 → 2026-09-30`). Times without an offset are read in the
 * viewer's zone. `dayFirst` settles numeric dates such as `03/04/2026` (US month-first by
 * default); a first number above 12 always means day-first.
 *
 * @example
 * parseDateText('Sep 23, 2026 2:30 PM', ctx); // { start: '2026-09-23T18:30:00.000Z', includeTime: true } in New York
 */
export function parseDateText(
  text: string,
  ctx: Pick<QueryContext, 'timeZone'>,
  options: { dayFirst?: boolean } = {},
): DateValue | null {
  const parts = text.trim().split(RANGE_SEPARATOR);
  if (parts.length > 2) return null;
  const points = parts.map((part) => parsePoint(part, options.dayFirst ?? false));
  const [start, end] = points;
  if (!start || points.some((point) => point === null)) return null;
  const withTime = points.some(
    (point) => point && (point.minutes !== null || point.instant !== null),
  );
  const toIso = (point: ParsedPoint) => {
    const instant =
      point.instant ?? zonedTimeToInstant(point.day, 0, point.minutes ?? 0, ctx.timeZone);
    return new Date(instant).toISOString();
  };
  if (!withTime) {
    const value: DateValue = { start: start.day };
    if (end && end.day !== start.day) {
      if (end.day < start.day) return null;
      value.end = end.day;
    }
    return value;
  }
  const value: DateValue = { start: toIso(start), includeTime: true };
  if (end) {
    const endIso = toIso(end);
    if (Date.parse(endIso) < Date.parse(value.start)) return null;
    if (endIso !== value.start) value.end = endIso;
  }
  return value;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;
const URL_LIKE = /^(https?:\/\/[^\s]+|www\.[^\s]+\.[^\s]+)$/i;

/** True for text that looks like an email address. */
export function looksLikeEmail(text: string): boolean {
  return EMAIL.test(text.trim());
}

/** True for text that looks like a web address (`https://…` or `www.…`). */
export function looksLikeUrl(text: string): boolean {
  return URL_LIKE.test(text.trim());
}

/** Splits a multi-select cell (`Design, Research`) into unique, trimmed names. */
export function splitNames(text: string): string[] {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const raw of text.split(',')) {
    const name = raw.trim();
    const key = name.toLowerCase();
    if (name && !seen.has(key)) {
      seen.add(key);
      names.push(name);
    }
  }
  return names;
}

/** The result of {@link parseCellText}. */
export type ParsedCell =
  /** A value ready to store; null clears the cell. */
  | { kind: 'value'; value: JsonValue | null }
  /** Select or multi-select option names; the caller maps them to options, creating new ones. */
  | { kind: 'options'; names: string[] }
  /** Relation targets by title; the caller looks the pages up. */
  | { kind: 'pages'; titles: string[] }
  /** The row's title (rename the row page). */
  | { kind: 'title'; title: string }
  /** The text cannot become a value of this type. */
  | { kind: 'invalid' }
  /** Computed columns (created and updated time, formulas) cannot be written. */
  | { kind: 'readOnly' };

/**
 * Parses text typed or pasted into a cell. Empty text clears the cell. Numbers in a percent
 * column are percentage points (`25` and `25%` both store 0.25), like what the column shows.
 *
 * @example
 * parseCellText('Sep 30, 2026', dueProperty, ctx); // { kind: 'value', value: { start: '2026-09-30' } }
 */
export function parseCellText(
  text: string,
  property: PropertyDefinition,
  ctx: Pick<QueryContext, 'timeZone'>,
  options: { dayFirst?: boolean } = {},
): ParsedCell {
  const trimmed = text.trim();
  switch (property.type) {
    case 'title':
      return { kind: 'title', title: text.replace(/[\r\n\t]+/g, ' ').trim() };
    case 'createdTime':
    case 'updatedTime':
    case 'formula':
      return { kind: 'readOnly' };
    default:
      break;
  }
  if (trimmed === '') return { kind: 'value', value: null };
  switch (property.type) {
    case 'text':
      return text.length <= MAX_TEXT_VALUE_LENGTH
        ? { kind: 'value', value: text }
        : { kind: 'invalid' };
    case 'url':
      return trimmed.length <= MAX_URL_LENGTH
        ? { kind: 'value', value: trimmed }
        : { kind: 'invalid' };
    case 'email':
      return trimmed.length <= 320 ? { kind: 'value', value: trimmed } : { kind: 'invalid' };
    case 'number': {
      const parsed = parseNumberText(trimmed);
      if (!parsed) return { kind: 'invalid' };
      const value =
        property.number?.format === 'percent' && !parsed.percent
          ? parsed.value / 100
          : parsed.value;
      return { kind: 'value', value };
    }
    case 'checkbox': {
      const checked = parseBooleanText(trimmed, { numeric: true });
      return checked === null ? { kind: 'invalid' } : { kind: 'value', value: checked };
    }
    case 'date': {
      const date = parseDateText(trimmed, ctx, options);
      return date ? { kind: 'value', value: date as unknown as JsonValue } : { kind: 'invalid' };
    }
    case 'select':
      return { kind: 'options', names: [trimmed.replace(/[\r\n\t]+/g, ' ')] };
    case 'multiSelect':
      return { kind: 'options', names: splitNames(trimmed.replace(/[\r\n\t]+/g, ' ')) };
    case 'relation':
      return { kind: 'pages', titles: splitNames(trimmed) };
  }
}
