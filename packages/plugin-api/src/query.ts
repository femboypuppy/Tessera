import { PluginError } from './errors';
import type {
  DatabaseProperty,
  DatabaseQuery,
  DatabaseQueryResult,
  DatabaseRow,
  JsonValue,
  RowFilter,
  RowInput,
} from './types';

/**
 * The row query engine behind `api.databases.query`, shared by the host and the test harness so
 * both behave the same. Pure functions over resolved rows.
 */

/** Default and largest page size of a query. */
export const DEFAULT_QUERY_LIMIT = 100;
export const MAX_QUERY_LIMIT = 1_000;

const COMPUTED_TYPES = new Set(['title', 'createdTime', 'updatedTime', 'formula']);

/** Finds a property by ID, or by name (case-insensitive). */
export function findProperty(
  properties: readonly DatabaseProperty[],
  reference: string,
): DatabaseProperty | undefined {
  const byId = properties.find((property) => property.id === reference);
  if (byId) return byId;
  const lower = reference.trim().toLowerCase();
  return properties.find((property) => property.name.trim().toLowerCase() === lower);
}

function requireProperty(properties: readonly DatabaseProperty[], reference: string) {
  const property = findProperty(properties, reference);
  if (!property) throw new PluginError('invalid', `This database has no property "${reference}"`);
  return property;
}

/** Resolves an option reference (ID or name, case-insensitive) to its ID. */
function optionId(property: DatabaseProperty, reference: JsonValue | undefined): string {
  if (typeof reference !== 'string')
    throw new PluginError('invalid', `Options of "${property.name}" are given by ID or name`);
  const options = property.options ?? [];
  const byId = options.find((option) => option.id === reference);
  if (byId) return byId.id;
  const lower = reference.trim().toLowerCase();
  const byName = options.find((option) => option.name.trim().toLowerCase() === lower);
  if (byName) return byName.id;
  throw new PluginError('invalid', `"${property.name}" has no option "${reference}"`);
}

function isEmpty(value: JsonValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    value === '' ||
    value === false ||
    (Array.isArray(value) && value.length === 0)
  );
}

/** A comparable scalar for a cell: numbers for numbers and times, strings for the rest. */
function scalar(property: DatabaseProperty, value: JsonValue | undefined): string | number | null {
  if (value === undefined || value === null) return null;
  switch (property.type) {
    case 'number':
    case 'createdTime':
    case 'updatedTime':
      return typeof value === 'number' ? value : null;
    case 'checkbox':
      return value === true ? 1 : 0;
    case 'date':
      if (typeof value === 'object' && !Array.isArray(value) && typeof value.start === 'string')
        return value.start;
      return null;
    case 'select': {
      const index = (property.options ?? []).findIndex((option) => option.id === value);
      return index >= 0 ? index : null;
    }
    case 'multiSelect': {
      if (!Array.isArray(value) || value.length === 0) return null;
      const indexes = value
        .map((id) => (property.options ?? []).findIndex((option) => option.id === id))
        .filter((index) => index >= 0);
      return indexes.length ? Math.min(...indexes) : null;
    }
    default:
      return typeof value === 'string' ? value.toLocaleLowerCase() : JSON.stringify(value);
  }
}

function numberValue(value: JsonValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

/** The value a filter compares against, in the cell's terms. */
function filterOperand(property: DatabaseProperty, filter: RowFilter): JsonValue | undefined {
  if (filter.operator === 'isEmpty' || filter.operator === 'isNotEmpty') return undefined;
  if (filter.value === undefined)
    throw new PluginError('invalid', `The "${filter.operator}" filter needs a value`);
  switch (property.type) {
    case 'select':
    case 'multiSelect':
      return optionId(property, filter.value);
    case 'number':
    case 'createdTime':
    case 'updatedTime': {
      const number = numberValue(filter.value);
      if (number === null && typeof filter.value === 'string') {
        const time = Date.parse(filter.value);
        if (Number.isFinite(time)) return time;
      }
      if (number === null)
        throw new PluginError('invalid', `Filters on "${property.name}" need a number`);
      return number;
    }
    case 'checkbox':
      return filter.value === true || filter.value === 'true';
    case 'date':
      if (typeof filter.value !== 'string')
        throw new PluginError('invalid', `Filters on "${property.name}" need a date string`);
      return filter.value;
    default:
      return filter.value;
  }
}

function matches(property: DatabaseProperty, cell: JsonValue | undefined, filter: RowFilter) {
  const operand = filterOperand(property, filter);
  switch (filter.operator) {
    case 'isEmpty':
      return isEmpty(cell);
    case 'isNotEmpty':
      return !isEmpty(cell);
    case 'equals':
    case 'notEquals': {
      let equal: boolean;
      if (property.type === 'multiSelect' || property.type === 'relation')
        equal = Array.isArray(cell) && cell.includes(operand as string);
      else if (property.type === 'checkbox') equal = (cell === true) === operand;
      else if (property.type === 'date') {
        const start = scalar(property, cell);
        equal = typeof start === 'string' && start.slice(0, 10) === String(operand).slice(0, 10);
      } else if (typeof operand === 'number') equal = numberValue(cell) === operand;
      else if (typeof operand === 'string' && typeof cell === 'string')
        equal = cell.toLocaleLowerCase() === operand.toLocaleLowerCase();
      else equal = JSON.stringify(cell ?? null) === JSON.stringify(operand ?? null);
      return filter.operator === 'equals' ? equal : !equal;
    }
    case 'contains':
    case 'notContains': {
      let contained: boolean;
      if (Array.isArray(cell)) contained = cell.includes(operand as string);
      else if (property.type === 'select') contained = cell === operand;
      else
        contained =
          typeof cell === 'string' &&
          cell.toLocaleLowerCase().includes(String(operand).toLocaleLowerCase());
      return filter.operator === 'contains' ? contained : !contained;
    }
    case 'greaterThan':
    case 'lessThan': {
      const left =
        property.type === 'date'
          ? scalar(property, cell)
          : (numberValue(cell) ?? scalar(property, cell));
      const right = typeof operand === 'number' || typeof operand === 'string' ? operand : null;
      if (left === null || right === null) return false;
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : String(left).localeCompare(String(right), undefined, { numeric: true });
      return filter.operator === 'greaterThan' ? order > 0 : order < 0;
    }
  }
}

/**
 * Filters, sorts and pages rows. Filters are ANDed. Empty cells sort last in both directions; ties
 * keep the input order.
 *
 * @example
 * runRowQuery(properties, rows, { filters: [{ property: 'Status', operator: 'equals', value: 'Done' }] });
 */
export function runRowQuery(
  properties: readonly DatabaseProperty[],
  rows: readonly DatabaseRow[],
  query: DatabaseQuery = {},
): DatabaseQueryResult {
  const filters = (query.filters ?? []).map((filter) => ({
    filter,
    property: requireProperty(properties, filter.property),
  }));
  const sorts = (query.sorts ?? []).map((sort) => ({
    property: requireProperty(properties, sort.property),
    descending: sort.direction === 'descending',
  }));
  const limit = Math.max(0, Math.min(query.limit ?? DEFAULT_QUERY_LIMIT, MAX_QUERY_LIMIT));
  const offset = Math.max(0, query.offset ?? 0);

  const matched = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) =>
      filters.every(({ filter, property }) => matches(property, row.values[property.id], filter)),
    );
  if (sorts.length) {
    matched.sort((a, b) => {
      for (const { property, descending } of sorts) {
        const left = scalar(property, a.row.values[property.id]);
        const right = scalar(property, b.row.values[property.id]);
        if (left === null && right === null) continue;
        if (left === null) return 1;
        if (right === null) return -1;
        const order =
          typeof left === 'number' && typeof right === 'number'
            ? left - right
            : String(left).localeCompare(String(right), undefined, { numeric: true });
        if (order !== 0) return descending ? -order : order;
      }
      return a.index - b.index;
    });
  }
  return {
    rows: matched.slice(offset, offset + limit).map(({ row }) => row),
    total: matched.length,
  };
}

/** A {@link RowInput} with property and option references resolved to IDs. */
export interface ResolvedRowInput {
  title?: string;
  values: Record<string, JsonValue | null>;
}

/**
 * Resolves property names to IDs and select option names to IDs. A value for the title property
 * becomes `title`. Computed properties (times, formulas) are rejected.
 */
export function resolveRowInput(
  properties: readonly DatabaseProperty[],
  input: RowInput,
): ResolvedRowInput {
  const resolved: ResolvedRowInput = { values: {} };
  if (input.title !== undefined) resolved.title = input.title;
  for (const [reference, value] of Object.entries(input.values ?? {})) {
    const property = requireProperty(properties, reference);
    if (property.type === 'title') {
      if (value !== null && typeof value !== 'string')
        throw new PluginError('invalid', `"${property.name}" is the title: give it text`);
      resolved.title = value ?? '';
      continue;
    }
    if (COMPUTED_TYPES.has(property.type))
      throw new PluginError('invalid', `"${property.name}" is computed and can't be set`);
    if (value === null) resolved.values[property.id] = null;
    else if (property.type === 'select') resolved.values[property.id] = optionId(property, value);
    else if (property.type === 'multiSelect') {
      if (!Array.isArray(value))
        throw new PluginError('invalid', `"${property.name}" takes a list of options`);
      resolved.values[property.id] = [...new Set(value.map((item) => optionId(property, item)))];
    } else resolved.values[property.id] = value;
  }
  return resolved;
}
