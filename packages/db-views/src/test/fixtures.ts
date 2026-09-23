import {
  DEFAULT_DATE_CONFIG,
  DEFAULT_NUMBER_CONFIG,
  DEFAULT_RELATION_CONFIG,
  type JsonValue,
  type PropertyDefinition,
  type PropertyType,
  type SelectOption,
  type TagColor,
} from '@tessera/core';
import { createQueryContext, type QueryContext, type QueryRow } from '../query';

/** 2026-09-23 12:00 UTC, a Wednesday. */
export const NOW = Date.UTC(2026, 8, 23, 12, 0, 0);

/** A context pinned to UTC, en-US, weeks on Monday, "now" = {@link NOW}. */
export function testContext(overrides: Partial<QueryContext> = {}): QueryContext {
  return createQueryContext({
    now: NOW,
    timeZone: 'UTC',
    locale: 'en-US',
    weekStartsOn: 1,
    ...overrides,
  });
}

let order = 0;

/** A property definition with sensible type configs. */
export function property(
  id: string,
  type: PropertyType,
  overrides: Partial<PropertyDefinition> = {},
): PropertyDefinition {
  order += 1;
  const result: PropertyDefinition = { id, name: id, type, order: `a${order}` };
  if (type === 'number') result.number = { ...DEFAULT_NUMBER_CONFIG };
  if (type === 'date' || type === 'createdTime' || type === 'updatedTime')
    result.date = { ...DEFAULT_DATE_CONFIG };
  if (type === 'relation') result.relation = { ...DEFAULT_RELATION_CONFIG };
  if (type === 'select' || type === 'multiSelect') result.options = [];
  return { ...result, ...overrides };
}

/** Select options named after their IDs. */
export function options(...specs: Array<[id: string, color?: TagColor]>): SelectOption[] {
  return specs.map(([id, color], index) => ({
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    color: color ?? 'default',
    order: `a${index}`,
  }));
}

let rowCounter = 0;

/** A row with a title and stored values. */
export function row(
  title: string,
  values: Record<string, JsonValue> = {},
  overrides: Partial<QueryRow> = {},
): QueryRow {
  rowCounter += 1;
  return {
    id: overrides.id ?? `row${rowCounter}`,
    order: overrides.order ?? `a${String(rowCounter).padStart(6, '0')}`,
    title,
    values,
    createdAt: overrides.createdAt ?? NOW - rowCounter * 60_000,
    updatedAt: overrides.updatedAt ?? NOW,
    ...overrides,
  };
}

/** Titles of rows, for readable assertions. */
export function titles(rows: readonly QueryRow[]): string[] {
  return rows.map((entry) => entry.title);
}
