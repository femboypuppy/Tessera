import {
  isDateOnlyString,
  type DateValue,
  type NumberConfig,
  type PropertyType,
} from '@tessera/core';
import Papa from 'papaparse';

/** A parsed CSV file: unique, non-empty headers and rows padded to the header width. */
export interface CsvTable {
  headers: string[];
  rows: string[][];
}

/** Parses CSV text (RFC 4180, quoted fields, any line ending). */
export function parseCsv(text: string): CsvTable {
  const result = Papa.parse<string[]>(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text, {
    skipEmptyLines: 'greedy',
  });
  const [rawHeaders = [], ...rawRows] = result.data;
  const width = Math.max(rawHeaders.length, ...rawRows.map((row) => row.length));
  const taken = new Set<string>();
  const headers = Array.from({ length: width }, (_, index) => {
    const base =
      (rawHeaders[index] ?? '').replace(/\s+/g, ' ').trim() ||
      (index === 0 ? 'Name' : `Column ${index + 1}`);
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) name = `${base} (${n})`;
    taken.add(name.toLowerCase());
    return name;
  });
  const rows = rawRows.map((row) =>
    Array.from({ length: width }, (_, index) => (row[index] ?? '').trim()),
  );
  return { headers, rows };
}

/** Writes CSV (quoted where needed, `\n` line endings, a BOM so spreadsheets read UTF-8). */
export function writeCsv(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  return `\uFEFF${Papa.unparse({ fields: [...headers], data: rows.map((row) => [...row]) }, { newline: '\n' })}\n`;
}

// ---------------------------------------------------------------------------------------------
// Cell values
// ---------------------------------------------------------------------------------------------

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

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

interface DatePart {
  date: string;
  time: { hours: number; minutes: number; seconds: number; offset: string | null } | null;
}

function parseTime(raw: string | undefined): DatePart['time'] | undefined {
  if (!raw) return null;
  const match =
    /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*([AaPp][Mm])?\s*(Z|[+-]\d{2}:?\d{2}|UTC|GMT)?$/.exec(
      raw.trim(),
    );
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? 0);
  const meridiem = match[4]?.toLowerCase();
  if (meridiem) {
    if (hours < 1 || hours > 12) return undefined;
    if (meridiem === 'pm' && hours !== 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  }
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
  const zone = match[5];
  const offset =
    !zone || zone === 'UTC' || zone === 'GMT' || zone === 'Z'
      ? null
      : zone.replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  return { hours, minutes, seconds, offset };
}

function datePart(year: number, month: number, day: number): string | null {
  const date = `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
  return isDateOnlyString(date) ? date : null;
}

/** Parses one date (or date and time) in the formats Notion, spreadsheets and people write. */
function parseSingleDate(raw: string): DatePart | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](.+))?$/.exec(value);
  let date: string | null = null;
  let rest: string | undefined;
  if (match) {
    date = datePart(Number(match[1]), Number(match[2]), Number(match[3]));
    rest = match[4];
  } else if ((match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?: (.+))?$/.exec(value))) {
    date = datePart(Number(match[1]), Number(match[2]), Number(match[3]));
    rest = match[4];
  } else if (
    (match = /^([A-Za-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})(?:,? (?:at )?(.+))?$/.exec(
      value,
    ))
  ) {
    const month = MONTHS[match[1]?.toLowerCase() ?? ''];
    date = month ? datePart(Number(match[3]), month, Number(match[2])) : null;
    rest = match[4];
  } else if ((match = /^(\d{1,2}) ([A-Za-z]{3,9})\.? (\d{4})(?:,? (.+))?$/.exec(value))) {
    const month = MONTHS[match[2]?.toLowerCase() ?? ''];
    date = month ? datePart(Number(match[3]), month, Number(match[1])) : null;
    rest = match[4];
  } else if ((match = /^(\d{1,2})([/.])(\d{1,2})\2(\d{4})(?:,? (.+))?$/.exec(value))) {
    const first = Number(match[1]);
    const second = Number(match[3]);
    // Dotted dates are day-first; slashed ones month-first (US, Notion) unless that is impossible.
    const dayFirst = match[2] === '.' || first > 12;
    date = dayFirst
      ? datePart(Number(match[4]), second, first)
      : datePart(Number(match[4]), first, second);
    rest = match[5];
  }
  if (!date) return null;
  const time = parseTime(rest);
  if (time === undefined) return null;
  return { date, time };
}

function toInstant(part: DatePart): string {
  const time = part.time;
  if (!time) return part.date;
  const local = `${part.date}T${pad(time.hours)}:${pad(time.minutes)}:${pad(time.seconds)}`;
  // Times without a zone are read as UTC, so imports are the same on every machine.
  return new Date(`${local}${time.offset ?? 'Z'}`).toISOString();
}

/** Parses a date cell (`2026-09-23`, `September 23, 2026 3:30 PM`, `A → B` ranges). */
export function parseDateCell(value: string): DateValue | null {
  const [startRaw, endRaw, ...more] = value.split(/\s*→\s*/);
  if (!startRaw || more.length) return null;
  const start = parseSingleDate(startRaw);
  if (!start) return null;
  const end = endRaw ? parseSingleDate(endRaw) : null;
  if (endRaw && !end) return null;
  const includeTime = Boolean(start.time || end?.time);
  const normalize = (part: DatePart) =>
    includeTime
      ? toInstant({
          ...part,
          time: part.time ?? { hours: 0, minutes: 0, seconds: 0, offset: null },
        })
      : part.date;
  const result: DateValue = { start: normalize(start) };
  if (end) {
    const endValue = normalize(end);
    if (endValue < result.start) return null;
    result.end = endValue;
  }
  if (includeTime) result.includeTime = true;
  return result;
}

const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  $: 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'JPY',
  '₹': 'INR',
  '₩': 'KRW',
  CHF: 'CHF',
};

/** A parsed number cell, with the display format it was written in. */
export interface NumberCell {
  value: number;
  percent: boolean;
  currency: string | null;
  decimals: number;
}

/** Parses `1,234.5`, `-3`, `45%`, `$1,200.00`, `€ 9,99`-style cells. */
export function parseNumberCell(raw: string): NumberCell | null {
  let value = raw.trim().replace(/\s+/g, '');
  if (!value) return null;
  let currency: string | null = null;
  const isoCode = /^([A-Z]{3})(?=[-\d.])|(?<=[\d.])([A-Z]{3})$/.exec(value);
  if (isoCode) {
    currency = isoCode[1] ?? isoCode[2] ?? null;
    value = value.replace(/^[A-Z]{3}|[A-Z]{3}$/, '');
  }
  const symbol = /^-?([$€£¥₹₩])|([$€£¥₹₩])$/.exec(value);
  if (symbol) {
    currency = CURRENCY_SYMBOLS[symbol[1] ?? symbol[2] ?? ''] ?? currency;
    value = value.replace(/[$€£¥₹₩]/, '');
  }
  const percent = value.endsWith('%');
  if (percent) value = value.slice(0, -1);
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) value = value.replace(/,/g, '');
  // Not `\d+\.?\d*`: with the dot optional, the two digit runs split `000…0x` every which way.
  if (!/^-?(\d+(?:\.\d*)?|\.\d+)(e[+-]?\d+)?$/i.test(value)) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const decimals = /\.(\d+)/.exec(value)?.[1]?.length ?? 0;
  return {
    value: percent ? Number((number / 100).toPrecision(15)) : number,
    percent,
    currency: percent ? null : currency,
    decimals,
  };
}

const TRUE_VALUES = new Set(['yes', 'true', 'checked', 'done', '✓', '✔', '☑', '✅', '[x]']);
const FALSE_VALUES = new Set(['no', 'false', 'unchecked', '☐', '❌', '✗', '[ ]']);

export function parseCheckboxCell(value: string): boolean | null {
  const lower = value.trim().toLowerCase();
  if (TRUE_VALUES.has(lower)) return true;
  if (FALSE_VALUES.has(lower)) return false;
  return null;
}

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/** One linked page in a relation cell: `Title (path/to/Page.md)` or `Title (https://notion.so/…)`. */
export interface RelationToken {
  title: string;
  target: string;
}

/** Splits a relation cell into its links, or returns null when it is not a relation cell. */
export function parseRelationCell(value: string): RelationToken[] | null {
  const tokens: RelationToken[] = [];
  const pattern =
    /\s*([^,]*?)\s*\(((?:[^()]|\([^()]*\))+?\.(?:md|csv)|https?:\/\/[^)\s]+)\)\s*(?:,|$)/gy;
  let index = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    tokens.push({ title: match[1] ?? '', target: match[2] ?? '' });
    index = pattern.lastIndex;
  }
  return tokens.length && index >= value.trimEnd().length ? tokens : null;
}

/** Splits a multi-select cell (`a, b, c`). */
export function splitList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of value.split(',')) {
    const item = raw.trim();
    if (item && !seen.has(item.toLowerCase())) {
      seen.add(item.toLowerCase());
      items.push(item);
    }
  }
  return items;
}

// ---------------------------------------------------------------------------------------------
// Column types
// ---------------------------------------------------------------------------------------------

/** How a CSV column is imported. */
export interface InferredColumn {
  name: string;
  type: PropertyType;
  number?: Partial<NumberConfig>;
  /** Options of select and multi-select columns, in first-seen order. */
  options?: string[];
}

const LIST_NAME = /\b(tags?|labels|categories|topics|keywords|genres|skills)\b/i;
const SELECT_NAME = /\b(status|stage|state|priority|type|kind|level|phase|category|group)\b/i;
const CREATED_NAME = /^(created( time| at| on)?|date created)$/i;
const UPDATED_NAME = /^(last edited( time)?|last modified|updated( at)?|modified( at)?)$/i;

/**
 * Infers a column's property type from its name and values: checkbox, number (plain, percent,
 * currency), date, URL, email, relation (links to pages), select, multi-select or text.
 * `isRelationTarget` tells whether a relation token points at an imported page.
 */
export function inferColumn(
  name: string,
  values: readonly string[],
  isRelationTarget: (token: RelationToken) => boolean = () => false,
): InferredColumn {
  const filled = values.map((value) => value.trim()).filter(Boolean);
  if (filled.length === 0) return { name, type: 'text' };
  if (filled.every((value) => parseCheckboxCell(value) !== null)) return { name, type: 'checkbox' };
  const numbers = filled.map(parseNumberCell);
  if (numbers.every((cell) => cell !== null)) {
    const cells = numbers as NumberCell[];
    const decimals = Math.max(...cells.map((cell) => cell.decimals));
    if (cells.every((cell) => cell.percent))
      return {
        name,
        type: 'number',
        number: { format: 'percent', precision: Math.max(0, decimals) },
      };
    const currency = cells[0]?.currency;
    if (currency && cells.every((cell) => cell.currency === currency))
      return {
        name,
        type: 'number',
        number: { format: 'currency', currency, precision: decimals },
      };
    return { name, type: 'number', number: { format: 'plain', precision: decimals || null } };
  }
  const dates = filled.map(parseDateCell);
  if (dates.every((date) => date !== null)) {
    const withTime = dates.some((date) => date?.includeTime);
    if (withTime && CREATED_NAME.test(name)) return { name, type: 'createdTime' };
    if (withTime && UPDATED_NAME.test(name)) return { name, type: 'updatedTime' };
    return { name, type: 'date' };
  }
  if (filled.every((value) => URL_PATTERN.test(value))) return { name, type: 'url' };
  if (filled.every((value) => EMAIL_PATTERN.test(value))) return { name, type: 'email' };
  const relations = filled.map(parseRelationCell);
  if (relations.every((tokens) => tokens?.every(isRelationTarget)))
    return { name, type: 'relation' };

  const lists = filled.map(splitList);
  const hasList = lists.some((items) => items.length > 1);
  const tokens = lists.flat();
  const distinct = [...new Map(tokens.map((token) => [token.toLowerCase(), token])).values()];
  const longest = Math.max(...tokens.map((token) => token.length));
  const repeats = distinct.length < tokens.length;
  // Sentences with commas are text, not lists.
  const sentenceLike = tokens.some(
    (token) => /[.!?]$/.test(token) || token.split(/\s+/).length > 5,
  );
  if (
    hasList &&
    !sentenceLike &&
    longest <= 60 &&
    distinct.length <= 100 &&
    (repeats || LIST_NAME.test(name))
  ) {
    return { name, type: 'multiSelect', options: distinct };
  }
  const distinctValues = [...new Map(filled.map((value) => [value.toLowerCase(), value])).values()];
  const valueRepeats = distinctValues.length < filled.length;
  const longestValue = Math.max(...filled.map((value) => value.length));
  if (
    longestValue <= 60 &&
    distinctValues.length <= 50 &&
    (LIST_NAME.test(name) ||
      SELECT_NAME.test(name) ||
      (valueRepeats && distinctValues.length <= Math.max(10, filled.length / 2)))
  ) {
    return { name, type: LIST_NAME.test(name) ? 'multiSelect' : 'select', options: distinctValues };
  }
  return { name, type: 'text' };
}
