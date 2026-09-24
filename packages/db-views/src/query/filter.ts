import {
  FILTER_OPERATORS_BY_TYPE,
  RELATIVE_DATE_RANGES,
  type DateOperand,
  type DateRangeOperand,
  type FilterCondition,
  type FilterNode,
  type FilterOperator,
  type FilterValue,
  type PropertyDefinition,
  type RelativeDateRange,
} from '@tessera/core';
import { readCell, readDateValue } from './cells';
import {
  addDays,
  dateSpan,
  dayKeyOfInstant,
  parseDayKey,
  resolveDateOperand,
  resolveRangeOperand,
  startOfDayInstant,
  todayKey,
  type DayRange,
} from './dates';
import { cleanNumber, dateToPlainText } from './format';
import { parseBooleanText, parseDateText } from './parse';
import { lowerText, sortCollator } from './text';
import type { QueryContext, QueryRow } from './types';

/** Decides whether a row passes. */
export type RowPredicate = (row: QueryRow) => boolean;

/*
 * Semantics (documented for plugin and export authors, who reuse this engine):
 *
 * - A condition is *inactive* when its property is gone, its operator does not apply to the
 *   property's current type (after a type change), or it needs a value that is missing or
 *   malformed. Inactive conditions are ignored, and so is a group whose children are all inactive.
 *   At the top level that is the same as "matches every row"; inside an OR group it means an
 *   unfinished condition does not turn the whole group into "match everything".
 * - Text operators are case-insensitive. An empty cell `is not` / `does not contain` anything.
 * - Select and multi-select values that point to deleted options count as empty; relations only
 *   count pages that `QueryContext.isPageVisible` accepts.
 * - Dates compare by calendar day in the viewer's zone. `is` and `is within` match when the value
 *   (a day, a range or an instant) overlaps the operand's days; before and after compare the
 *   value's start. A missing checkbox is unchecked, and `is empty` on a checkbox means unchecked.
 * - Formula results are compared by their kind: numbers as numbers, checkboxes as true or false,
 *   dates by calendar day and text as case-insensitive text (the condition's value is text).
 */

const ANY_TYPE_OPERATORS: readonly FilterOperator[] = ['isEmpty', 'isNotEmpty'];

/** True when `operator` applies to `property` (the empty checks apply to every type). */
export function operatorApplies(property: PropertyDefinition, operator: FilterOperator): boolean {
  return (
    ANY_TYPE_OPERATORS.includes(operator) ||
    FILTER_OPERATORS_BY_TYPE[property.type].includes(operator)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: FilterValue | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function asNumber(value: FilterValue | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asStringList(value: FilterValue | undefined): string[] | null {
  if (!Array.isArray(value)) return null;
  const list = value.filter((item): item is string => typeof item === 'string' && item !== '');
  return list.length > 0 ? list : null;
}

function asDateOperand(value: FilterValue | undefined): DateOperand | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'exact')
    return typeof value.date === 'string' && parseDayKey(value.date)
      ? { kind: 'exact', date: value.date }
      : null;
  if (value.kind === 'relative') {
    const { unit, amount } = value;
    if (unit !== 'day' && unit !== 'week' && unit !== 'month' && unit !== 'year') return null;
    if (typeof amount !== 'number' || !Number.isFinite(amount)) return null;
    return { kind: 'relative', unit, amount };
  }
  return null;
}

function asRangeOperand(value: FilterValue | undefined): DateRangeOperand | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'range') {
    const range = value.range;
    return typeof range === 'string' && (RELATIVE_DATE_RANGES as readonly string[]).includes(range)
      ? { kind: 'range', range: range as RelativeDateRange }
      : null;
  }
  if (value.kind === 'between') {
    return typeof value.start === 'string' && typeof value.end === 'string'
      ? { kind: 'between', start: value.start, end: value.end }
      : null;
  }
  return null;
}

/** Resolves any date operand (single day or range) to inclusive days, or null. */
function resolveDays(value: FilterValue | undefined, ctx: QueryContext): DayRange | null {
  const today = todayKey(ctx.now, ctx.timeZone);
  const single = asDateOperand(value);
  if (single) {
    const day = resolveDateOperand(single, today);
    return day ? { start: day, end: day } : null;
  }
  const range = asRangeOperand(value);
  return range ? resolveRangeOperand(range, today, ctx.weekStartsOn) : null;
}

// ---------------------------------------------------------------------------------------------
// Per-type compilers. Each returns a predicate, or null when the condition is inactive.
// ---------------------------------------------------------------------------------------------

function compileText(
  read: (row: QueryRow) => string | null,
  operator: FilterOperator,
  value: FilterValue | undefined,
): RowPredicate | null {
  if (operator === 'isEmpty') return (row) => (read(row) ?? '').trim() === '';
  if (operator === 'isNotEmpty') return (row) => (read(row) ?? '').trim() !== '';
  const operand = asNonEmptyString(value);
  if (operand === null) return null;
  const needle = lowerText(operand);
  const cell = (row: QueryRow) => lowerText(read(row) ?? '');
  switch (operator) {
    case 'is':
      return (row) => cell(row) === needle;
    case 'isNot':
      return (row) => cell(row) !== needle;
    case 'contains':
      return (row) => cell(row).includes(needle);
    case 'doesNotContain':
      return (row) => !cell(row).includes(needle);
    case 'startsWith':
      return (row) => cell(row).startsWith(needle);
    case 'endsWith':
      return (row) => cell(row).endsWith(needle);
    default:
      return null;
  }
}

function compileNumber(
  read: (row: QueryRow) => number | null,
  operator: FilterOperator,
  value: FilterValue | undefined,
): RowPredicate | null {
  if (operator === 'isEmpty') return (row) => read(row) === null;
  if (operator === 'isNotEmpty') return (row) => read(row) !== null;
  const operand = asNumber(value);
  if (operand === null) return null;
  const test = (row: QueryRow, check: (cell: number) => boolean) => {
    const cell = read(row);
    return cell !== null && check(cell);
  };
  switch (operator) {
    case 'is':
      return (row) => test(row, (cell) => cell === operand);
    case 'isNot':
      return (row) => read(row) !== operand;
    case 'gt':
      return (row) => test(row, (cell) => cell > operand);
    case 'gte':
      return (row) => test(row, (cell) => cell >= operand);
    case 'lt':
      return (row) => test(row, (cell) => cell < operand);
    case 'lte':
      return (row) => test(row, (cell) => cell <= operand);
    default:
      return null;
  }
}

function compileSelect(
  property: PropertyDefinition,
  operator: FilterOperator,
  value: FilterValue | undefined,
): RowPredicate | null {
  const known = new Set(property.options?.map((option) => option.id));
  const read = (row: QueryRow): string | null => {
    const cell = readCell(row, property);
    return typeof cell === 'string' && known.has(cell) ? cell : null;
  };
  if (operator === 'isEmpty') return (row) => read(row) === null;
  if (operator === 'isNotEmpty') return (row) => read(row) !== null;
  if (operator === 'is' || operator === 'isNot') {
    const operand = asNonEmptyString(value);
    if (operand === null) return null;
    return operator === 'is' ? (row) => read(row) === operand : (row) => read(row) !== operand;
  }
  const list = asStringList(value);
  if (!list) return null;
  const set = new Set(list);
  if (operator === 'isAnyOf')
    return (row) => {
      const cell = read(row);
      return cell !== null && set.has(cell);
    };
  if (operator === 'isNoneOf')
    return (row) => {
      const cell = read(row);
      return cell === null || !set.has(cell);
    };
  return null;
}

function compileIdList(
  read: (row: QueryRow) => readonly string[],
  operator: FilterOperator,
  value: FilterValue | undefined,
): RowPredicate | null {
  if (operator === 'isEmpty') return (row) => read(row).length === 0;
  if (operator === 'isNotEmpty') return (row) => read(row).length > 0;
  if (operator === 'contains' || operator === 'doesNotContain') {
    const operand = asNonEmptyString(value);
    if (operand === null) return null;
    return operator === 'contains'
      ? (row) => read(row).includes(operand)
      : (row) => !read(row).includes(operand);
  }
  const list = asStringList(value);
  if (!list) return null;
  switch (operator) {
    case 'containsAnyOf':
      return (row) => read(row).some((id) => list.includes(id));
    case 'containsAllOf':
      return (row) => {
        const cell = read(row);
        return list.every((id) => cell.includes(id));
      };
    case 'containsNoneOf':
      return (row) => !read(row).some((id) => list.includes(id));
    default:
      return null;
  }
}

/** A date cell as days (date-only values) or instants (values with a time, created/updated). */
type DateCell =
  { days: true; start: string; end: string } | { days: false; start: number; end: number };

function compileDate(
  read: (row: QueryRow) => DateCell | null,
  operator: FilterOperator,
  value: FilterValue | undefined,
  ctx: QueryContext,
): RowPredicate | null {
  if (operator === 'isEmpty') return (row) => read(row) === null;
  if (operator === 'isNotEmpty') return (row) => read(row) !== null;
  const days = resolveDays(value, ctx);
  if (!days) return null;
  const startMs = startOfDayInstant(days.start, ctx.timeZone);
  const endExclusive = startOfDayInstant(addDays(days.end, 1), ctx.timeZone);
  const overlaps = (cell: DateCell) =>
    cell.days
      ? cell.start <= days.end && cell.end >= days.start
      : cell.start < endExclusive && cell.end >= startMs;
  const tests: Partial<Record<FilterOperator, (cell: DateCell) => boolean>> = {
    is: overlaps,
    isWithin: overlaps,
    isBefore: (cell) => (cell.days ? cell.start < days.start : cell.start < startMs),
    isAfter: (cell) => (cell.days ? cell.start > days.end : cell.start >= endExclusive),
    isOnOrBefore: (cell) => (cell.days ? cell.start <= days.end : cell.start < endExclusive),
    isOnOrAfter: (cell) => (cell.days ? cell.start >= days.start : cell.start >= startMs),
  };
  const test = tests[operator];
  if (!test) return null;
  return (row) => {
    const cell = read(row);
    return cell !== null && test(cell);
  };
}

/** Plain text of a formula result, for `contains`. */
function formulaText(value: unknown, ctx: QueryContext): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(cleanNumber(value));
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const date = readDateValue(value);
  return date ? dateToPlainText(date, ctx) : '';
}

function compileFormulaCondition(
  property: PropertyDefinition,
  operator: FilterOperator,
  value: FilterValue | undefined,
  ctx: QueryContext,
): RowPredicate | null {
  const read = (row: QueryRow) => readCell(row, property);
  const empty = (row: QueryRow) => {
    const cell = read(row);
    return cell === null || cell === '';
  };
  if (operator === 'isEmpty') return empty;
  if (operator === 'isNotEmpty') return (row) => !empty(row);
  const text =
    typeof value === 'string'
      ? value.trim()
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  if (text === '') return null;
  const number = asNumber(typeof value === 'boolean' ? undefined : value);
  const bool = typeof value === 'boolean' ? value : parseBooleanText(text);
  const parsedDate = parseDateText(text, ctx);
  const day = parsedDate
    ? parsedDate.includeTime
      ? dayKeyOfInstant(Date.parse(parsedDate.start), ctx.timeZone)
      : parsedDate.start
    : null;
  const needle = lowerText(text);
  const collator = sortCollator(ctx.locale);
  /** Negative, zero or positive like a comparator, or null when the two can't be compared. */
  const order = (cell: unknown): number | null => {
    if (typeof cell === 'number') return number === null ? null : cell - number;
    if (typeof cell === 'string') return collator.compare(cell, text);
    const date = readDateValue(cell);
    if (!date || day === null) return null;
    const span = dateSpan(date, ctx.timeZone);
    if (span.startDay <= day && span.endDay >= day) return 0;
    return span.startDay < day ? -1 : 1;
  };
  const equals = (cell: unknown): boolean => {
    if (cell === null) return false;
    if (typeof cell === 'boolean') return bool !== null && cell === bool;
    if (typeof cell === 'number')
      return number !== null && cleanNumber(cell) === cleanNumber(number);
    if (typeof cell === 'string') return lowerText(cell) === needle;
    return order(cell) === 0;
  };
  const compare = (check: (difference: number) => boolean) => (row: QueryRow) => {
    const difference = order(read(row));
    return difference !== null && check(difference);
  };
  switch (operator) {
    case 'is':
      return (row) => equals(read(row));
    case 'isNot':
      return (row) => !equals(read(row));
    case 'contains':
      return (row) => lowerText(formulaText(read(row), ctx)).includes(needle);
    case 'doesNotContain':
      return (row) => !lowerText(formulaText(read(row), ctx)).includes(needle);
    case 'gt':
      return compare((difference) => difference > 0);
    case 'gte':
      return compare((difference) => difference >= 0);
    case 'lt':
      return compare((difference) => difference < 0);
    case 'lte':
      return compare((difference) => difference <= 0);
    default:
      return null;
  }
}

function dateReader(property: PropertyDefinition): (row: QueryRow) => DateCell | null {
  if (property.type === 'createdTime')
    return (row) => ({ days: false, start: row.createdAt, end: row.createdAt });
  if (property.type === 'updatedTime')
    return (row) => ({ days: false, start: row.updatedAt, end: row.updatedAt });
  return (row) => {
    const value = readDateValue(row.values[property.id]);
    if (!value) return null;
    if (value.includeTime) {
      const start = Date.parse(value.start);
      return { days: false, start, end: value.end ? Date.parse(value.end) : start };
    }
    return { days: true, start: value.start, end: value.end ?? value.start };
  };
}

/** Readers of select-like cells that drop unknown options and hidden pages. */
export function idListReader(
  property: PropertyDefinition,
  ctx: QueryContext,
): (row: QueryRow) => readonly string[] {
  if (property.type === 'relation') {
    const visible = ctx.isPageVisible;
    return (row) => {
      const cell = readCell(row, property);
      if (!Array.isArray(cell)) return [];
      const ids = cell as string[];
      return visible ? ids.filter((id) => visible(id)) : ids;
    };
  }
  const known = new Set(property.options?.map((option) => option.id));
  return (row) => {
    const cell = readCell(row, property);
    if (!Array.isArray(cell)) return [];
    const ids = cell as string[];
    return ids.every((id) => known.has(id)) ? ids : ids.filter((id) => known.has(id));
  };
}

/**
 * Compiles one condition, or returns null when it is inactive (see the semantics above).
 *
 * @example
 * const test = compileCondition({ type: 'condition', id: 'c1', propertyId: statusId, operator: 'is', value: doneId }, status, ctx);
 */
export function compileCondition(
  condition: FilterCondition,
  property: PropertyDefinition | undefined,
  ctx: QueryContext,
): RowPredicate | null {
  if (!property || !operatorApplies(property, condition.operator)) return null;
  const { operator, value } = condition;
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
      return compileText(
        (row) => {
          const cell = readCell(row, property);
          return typeof cell === 'string' ? cell : null;
        },
        operator,
        value,
      );
    case 'number':
      return compileNumber(
        (row) => {
          const cell = readCell(row, property);
          return typeof cell === 'number' ? cell : null;
        },
        operator,
        value,
      );
    case 'select':
      return compileSelect(property, operator, value);
    case 'multiSelect':
    case 'relation':
      return compileIdList(idListReader(property, ctx), operator, value);
    case 'date':
    case 'createdTime':
    case 'updatedTime':
      return compileDate(dateReader(property), operator, value, ctx);
    case 'checkbox': {
      const checked = (row: QueryRow) => readCell(row, property) === true;
      if (operator === 'isEmpty') return (row) => !checked(row);
      if (operator === 'isNotEmpty') return checked;
      if (typeof value !== 'boolean') return null;
      return (row) => checked(row) === value;
    }
    case 'formula':
      return compileFormulaCondition(property, operator, value, ctx);
  }
}

function compileNode(
  node: FilterNode,
  byId: ReadonlyMap<string, PropertyDefinition>,
  ctx: QueryContext,
  depth: number,
): RowPredicate | null {
  if (node.type === 'condition') return compileCondition(node, byId.get(node.propertyId), ctx);
  if (depth > 32 || !Array.isArray(node.children)) return null;
  const children: RowPredicate[] = [];
  for (const child of node.children) {
    const predicate = compileNode(child, byId, ctx, depth + 1);
    if (predicate) children.push(predicate);
  }
  if (children.length === 0) return null;
  const [first] = children;
  if (children.length === 1 && first) return first;
  if (node.conjunction === 'or') {
    return (row) => {
      for (const predicate of children) if (predicate(row)) return true;
      return false;
    };
  }
  return (row) => {
    for (const predicate of children) if (!predicate(row)) return false;
    return true;
  };
}

/**
 * Compiles a filter tree into a predicate. Returns null when nothing is active (every row passes),
 * so callers can skip filtering entirely.
 *
 * @example
 * const test = compileFilter(view.filter, properties, createQueryContext());
 * const visible = test ? rows.filter(test) : rows;
 */
export function compileFilter(
  filter: FilterNode | null | undefined,
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
): RowPredicate | null {
  if (!filter) return null;
  const byId = new Map(properties.map((property) => [property.id, property]));
  return compileNode(filter, byId, ctx, 0);
}

/** True when a condition takes part in filtering (see "inactive" above). */
export function isConditionActive(
  condition: FilterCondition,
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
): boolean {
  const property = properties.find((candidate) => candidate.id === condition.propertyId);
  return compileCondition(condition, property, ctx) !== null;
}

/** Filters rows; returns the input array when no condition is active. */
export function filterRows<R extends QueryRow>(
  rows: readonly R[],
  filter: FilterNode | null | undefined,
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
): readonly R[] {
  const test = compileFilter(filter, properties, ctx);
  return test ? rows.filter(test) : rows;
}
