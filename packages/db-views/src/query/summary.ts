import type { DateValue, PropertyDefinition, PropertyType, SummaryKind } from '@tessera/core';
import { readCell, readDateValue } from './cells';
import { dateSpan, instantSpan, startOfDayInstant, type DateSpan } from './dates';
import { idListReader } from './filter';
import type { QueryContext, QueryRow } from './types';

const COMMON: readonly SummaryKind[] = [
  'none',
  'count',
  'countEmpty',
  'countNotEmpty',
  'countUnique',
  'percentEmpty',
  'percentNotEmpty',
];
const NUMERIC: readonly SummaryKind[] = [
  ...COMMON,
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
];
const DATES: readonly SummaryKind[] = [...COMMON, 'earliest', 'latest', 'dateRange'];
const CHECKBOX: readonly SummaryKind[] = [
  'none',
  'count',
  'countChecked',
  'countUnchecked',
  'percentChecked',
  'percentUnchecked',
];

/** The summaries that make sense for each property type (the footer menu lists these). */
export const SUMMARY_KINDS_BY_TYPE: Readonly<Record<PropertyType, readonly SummaryKind[]>> = {
  title: COMMON,
  text: COMMON,
  url: COMMON,
  email: COMMON,
  select: COMMON,
  multiSelect: COMMON,
  relation: COMMON,
  number: NUMERIC,
  date: DATES,
  createdTime: DATES,
  updatedTime: DATES,
  checkbox: CHECKBOX,
  formula: COMMON,
};

/**
 * A computed summary, as data: views format it (numbers with the property's number format,
 * dates with its date format, durations in days, months or years).
 */
export type SummaryResult =
  | { type: 'none' }
  | { type: 'count'; value: number }
  /** A ratio between 0 and 1 (0 when there are no rows). */
  | { type: 'percent'; value: number }
  /** Null when no row has a number. */
  | { type: 'number'; value: number | null }
  /** Null when no row has a date. */
  | { type: 'date'; value: DateValue | null }
  /** Milliseconds between the earliest start and the latest end, null without dates. */
  | { type: 'duration'; value: number | null };

/** Values of one column: `empty` per row, plus the distinct units counted by `countUnique`. */
function columnFacts(
  rows: readonly QueryRow[],
  property: PropertyDefinition,
  ctx: QueryContext,
): { empty: number; unique: number } {
  let empty = 0;
  const unique = new Set<string>();
  const add = (key: string) => unique.add(key);
  switch (property.type) {
    case 'multiSelect':
    case 'relation': {
      const read = idListReader(property, ctx);
      for (const row of rows) {
        const ids = read(row);
        if (ids.length === 0) empty += 1;
        for (const id of ids) add(id);
      }
      break;
    }
    case 'select': {
      const known = new Set(property.options?.map((option) => option.id));
      for (const row of rows) {
        const value = readCell(row, property);
        if (typeof value === 'string' && known.has(value)) add(value);
        else empty += 1;
      }
      break;
    }
    case 'checkbox':
      for (const row of rows) {
        const checked = readCell(row, property) === true;
        if (!checked) empty += 1;
        add(String(checked));
      }
      break;
    case 'date':
      for (const row of rows) {
        const value = readDateValue(row.values[property.id]);
        if (value) add(JSON.stringify([value.start, value.end ?? null]));
        else empty += 1;
      }
      break;
    default:
      for (const row of rows) {
        const value = readCell(row, property);
        if (value === null || (typeof value === 'string' && value.trim() === '')) empty += 1;
        else add(typeof value === 'string' ? value.trim() : String(value));
      }
  }
  return { empty, unique: unique.size };
}

function numbers(rows: readonly QueryRow[], property: PropertyDefinition): number[] {
  const result: number[] = [];
  for (const row of rows) {
    const value = readCell(row, property);
    if (typeof value === 'number') result.push(value);
  }
  return result;
}

function spans(
  rows: readonly QueryRow[],
  property: PropertyDefinition,
  ctx: QueryContext,
): Array<{ span: DateSpan; value: DateValue }> {
  const result: Array<{ span: DateSpan; value: DateValue }> = [];
  for (const row of rows) {
    if (property.type === 'date') {
      const value = readDateValue(row.values[property.id]);
      if (value) result.push({ span: dateSpan(value, ctx.timeZone), value });
    } else {
      const ms = property.type === 'createdTime' ? row.createdAt : row.updatedAt;
      result.push({
        span: instantSpan(ms, ctx.timeZone),
        value: { start: new Date(ms).toISOString(), includeTime: true },
      });
    }
  }
  return result;
}

/** Adds numbers with Kahan compensation, so sums of many decimals stay exact enough to display. */
function preciseSum(values: readonly number[]): number {
  let sum = 0;
  let compensation = 0;
  for (const value of values) {
    const y = value - compensation;
    const t = sum + y;
    compensation = t - sum - y;
    sum = t;
  }
  return sum;
}

/**
 * Computes a table footer summary over the rows a view shows. Kinds that do not apply to the
 * property's type (see {@link SUMMARY_KINDS_BY_TYPE}) return `{ type: 'none' }`.
 *
 * @example
 * computeSummary('average', rows, estimateProperty, ctx); // { type: 'number', value: 3.5 }
 */
export function computeSummary(
  kind: SummaryKind,
  rows: readonly QueryRow[],
  property: PropertyDefinition,
  ctx: QueryContext,
): SummaryResult {
  if (!SUMMARY_KINDS_BY_TYPE[property.type].includes(kind)) return { type: 'none' };
  const total = rows.length;
  const ratio = (part: number) => (total === 0 ? 0 : part / total);
  switch (kind) {
    case 'none':
      return { type: 'none' };
    case 'count':
      return { type: 'count', value: total };
    case 'countEmpty':
    case 'countUnchecked':
      return { type: 'count', value: columnFacts(rows, property, ctx).empty };
    case 'countNotEmpty':
    case 'countChecked':
      return { type: 'count', value: total - columnFacts(rows, property, ctx).empty };
    case 'countUnique':
      return { type: 'count', value: columnFacts(rows, property, ctx).unique };
    case 'percentEmpty':
    case 'percentUnchecked':
      return { type: 'percent', value: ratio(columnFacts(rows, property, ctx).empty) };
    case 'percentNotEmpty':
    case 'percentChecked':
      return { type: 'percent', value: ratio(total - columnFacts(rows, property, ctx).empty) };
    case 'sum':
    case 'average':
    case 'median':
    case 'min':
    case 'max':
    case 'range': {
      const values = numbers(rows, property);
      if (values.length === 0) return { type: 'number', value: null };
      if (kind === 'sum') return { type: 'number', value: preciseSum(values) };
      if (kind === 'average') return { type: 'number', value: preciseSum(values) / values.length };
      const sorted = [...values].sort((a, b) => a - b);
      const min = sorted[0] ?? 0;
      const max = sorted[sorted.length - 1] ?? 0;
      if (kind === 'min') return { type: 'number', value: min };
      if (kind === 'max') return { type: 'number', value: max };
      if (kind === 'range') return { type: 'number', value: max - min };
      const middle = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 1
          ? (sorted[middle] ?? 0)
          : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
      return { type: 'number', value: median };
    }
    case 'earliest':
    case 'latest':
    case 'dateRange': {
      const list = spans(rows, property, ctx);
      if (list.length === 0)
        return kind === 'dateRange'
          ? { type: 'duration', value: null }
          : { type: 'date', value: null };
      // A date-only value ends at the start of its last day, so one day spans zero days.
      const endPoint = (span: DateSpan) =>
        span.includeTime ? span.endMs : startOfDayInstant(span.endDay, ctx.timeZone);
      let earliest = list[0];
      let latest = list[0];
      for (const entry of list) {
        if (earliest && entry.span.startMs < earliest.span.startMs) earliest = entry;
        if (latest && endPoint(entry.span) > endPoint(latest.span)) latest = entry;
      }
      if (!earliest || !latest) return { type: 'none' };
      if (kind === 'dateRange') {
        return {
          type: 'duration',
          value: Math.max(0, endPoint(latest.span) - earliest.span.startMs),
        };
      }
      const pick = kind === 'earliest' ? earliest.value : latest.value;
      const single: DateValue = {
        start: kind === 'earliest' ? pick.start : (pick.end ?? pick.start),
      };
      if (pick.includeTime) single.includeTime = true;
      if (pick.timeZone) single.timeZone = pick.timeZone;
      return { type: 'date', value: single };
    }
  }
}
