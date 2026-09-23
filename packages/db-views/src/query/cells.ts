import {
  ID_PATTERN,
  MAX_TEXT_VALUE_LENGTH,
  MAX_URL_LENGTH,
  type DateValue,
  type JsonValue,
  type PropertyDefinition,
  type StoredPropertyType,
} from '@tessera/core';
import type { QueryRow } from './types';

/*
 * Fast equivalents of core's zod value schemas (`propertyValueSchemas`). The query engine reads
 * every cell of every row on each keystroke in a filter, and zod costs microseconds per value, so
 * these hand-written guards do the same checks without allocations. `cells.test.ts` proves they
 * accept and return exactly what `validatePropertyValue` and `getCellValue` do.
 */

const MAX_EMAIL_LENGTH = 320;
const MAX_ID_LIST = 10_000;
const MAX_TIME_ZONE_LENGTH = 64;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

function daysInMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

/**
 * Same result as core's `isDateOnlyString` without allocating dates. Core validates through
 * `Date.UTC`, which reads years 0–99 as 1900–1999, so those years never validate; neither do they
 * here.
 */
export function isDateOnly(value: string): boolean {
  const match = value.length === 10 ? DATE_ONLY.exec(value) : null;
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return year >= 100 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

/** Same result as core's `isDateTimeString`. */
export function isDateTime(value: string): boolean {
  return (
    DATE_TIME.test(value) && !Number.isNaN(Date.parse(value)) && isDateOnly(value.slice(0, 10))
  );
}

/** Validated dates by stored object: rows keep their value objects until they change. */
const dateCache = new WeakMap<object, DateValue | null>();

function isIdList(value: unknown): value is string[] {
  if (!Array.isArray(value) || value.length > MAX_ID_LIST) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !ID_PATTERN.test(item) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a {@link DateValue} and returns a copy without unknown keys, or null. Results are
 * cached per stored object; treat them as read-only.
 */
export function readDateValue(value: unknown): DateValue | null {
  if (!isPlainObject(value)) return null;
  const cached = dateCache.get(value);
  if (cached !== undefined) return cached;
  const result = parseDateValue(value);
  dateCache.set(value, result);
  return result;
}

function parseDateValue(value: Record<string, unknown>): DateValue | null {
  const { start, end, includeTime, timeZone } = value;
  if (typeof start !== 'string') return null;
  if (end !== undefined && end !== null && typeof end !== 'string') return null;
  if (includeTime !== undefined && typeof includeTime !== 'boolean') return null;
  if (
    timeZone !== undefined &&
    timeZone !== null &&
    (typeof timeZone !== 'string' || timeZone.length < 1 || timeZone.length > MAX_TIME_ZONE_LENGTH)
  ) {
    return null;
  }
  const check = includeTime ? isDateTime : isDateOnly;
  if (!check(start)) return null;
  if (typeof end === 'string') {
    if (!check(end)) return null;
    if (includeTime ? Date.parse(end) < Date.parse(start) : end < start) return null;
  }
  const result: DateValue = { start };
  if (end !== undefined) result.end = end;
  if (includeTime !== undefined) result.includeTime = includeTime;
  if (timeZone !== undefined) result.timeZone = timeZone;
  return result;
}

/**
 * True when `value` is a valid stored value for `type`, exactly like
 * `validatePropertyValue(type, value).success` from `@tessera/core`.
 */
export function isValidStoredValue(type: StoredPropertyType, value: unknown): boolean {
  switch (type) {
    case 'text':
      return typeof value === 'string' && value.length <= MAX_TEXT_VALUE_LENGTH;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'select':
      return typeof value === 'string' && ID_PATTERN.test(value);
    case 'multiSelect':
    case 'relation':
      return isIdList(value);
    case 'date':
      return readDateValue(value) !== null;
    case 'checkbox':
      return typeof value === 'boolean';
    case 'url':
      return typeof value === 'string' && value.length <= MAX_URL_LENGTH;
    case 'email':
      return typeof value === 'string' && value.length <= MAX_EMAIL_LENGTH;
  }
}

/**
 * Reads a cell like core's `getCellValue`: the title for `title`, epoch milliseconds for
 * `createdTime` and `updatedTime`, the stored value when it validates for the property's current
 * type, and null for empty or invalid values (they can appear after a type change and are left in
 * place so switching back restores them) and for `formula`.
 */
export function readCell(row: QueryRow, property: PropertyDefinition): JsonValue {
  switch (property.type) {
    case 'title':
      return row.title;
    case 'createdTime':
      return row.createdAt;
    case 'updatedTime':
      return row.updatedAt;
    case 'formula':
      return null;
    case 'date':
      return readDateValue(row.values[property.id]) as JsonValue;
    default: {
      const value = row.values[property.id];
      if (value === undefined) return null;
      return isValidStoredValue(property.type, value) ? value : null;
    }
  }
}

/** Typed readers used by the engine: each returns null when the cell is empty or invalid. */
export function readString(row: QueryRow, property: PropertyDefinition): string | null {
  const value = readCell(row, property);
  return typeof value === 'string' ? value : null;
}

export function readNumber(row: QueryRow, property: PropertyDefinition): number | null {
  const value = readCell(row, property);
  return typeof value === 'number' ? value : null;
}

export function readIds(row: QueryRow, property: PropertyDefinition): readonly string[] {
  const value = readCell(row, property);
  if (typeof value === 'string') return [value];
  return Array.isArray(value) ? (value as string[]) : [];
}

export function readChecked(row: QueryRow, property: PropertyDefinition): boolean {
  return readCell(row, property) === true;
}
