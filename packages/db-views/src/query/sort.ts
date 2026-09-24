import type { PropertyDefinition, SortRule } from '@tessera/core';
import { readCell, readDateValue } from './cells';
import { startOfDayInstant } from './dates';
import { idListReader } from './filter';
import { sortCollator } from './text';
import type { QueryContext, QueryRow } from './types';

/** A precomputed sort key. Null means empty: empty values sort last in both directions. */
export type SortKey = null | number | string | readonly number[];

/**
 * Returns a function computing a row's sort key for a property:
 * - text-like values and the title sort with a numeric, locale-aware collator;
 * - select options sort by their option order (like Notion), multi-selects by their options'
 *   orders; unknown options count as empty;
 * - dates by their start (a date-only value starts at midnight in the viewer's zone), so dates with
 *   and without times interleave correctly;
 * - checkboxes unchecked first; relations by the titles of their (visible) pages.
 */
export function sortKeyReader(
  property: PropertyDefinition,
  ctx: QueryContext,
): (row: QueryRow) => SortKey {
  switch (property.type) {
    case 'title':
    case 'text':
    case 'url':
    case 'email':
      return (row) => {
        const value = readCell(row, property);
        return typeof value === 'string' && value.trim() !== '' ? value : null;
      };
    case 'number':
    case 'createdTime':
    case 'updatedTime':
      return (row) => {
        const value = readCell(row, property);
        return typeof value === 'number' ? value : null;
      };
    case 'select': {
      const rank = new Map(property.options?.map((option, index) => [option.id, index]));
      return (row) => {
        const value = readCell(row, property);
        return typeof value === 'string' ? (rank.get(value) ?? null) : null;
      };
    }
    case 'multiSelect': {
      const rank = new Map(property.options?.map((option, index) => [option.id, index]));
      const read = idListReader(property, ctx);
      return (row) => {
        const ranks = read(row)
          .map((id) => rank.get(id) ?? 0)
          .sort((a, b) => a - b);
        return ranks.length > 0 ? ranks : null;
      };
    }
    case 'date':
      return (row) => {
        const value = readDateValue(row.values[property.id]);
        if (!value) return null;
        return value.includeTime
          ? Date.parse(value.start)
          : startOfDayInstant(value.start, ctx.timeZone);
      };
    case 'checkbox':
      return (row) => (readCell(row, property) === true ? 1 : 0);
    case 'relation': {
      const read = idListReader(property, ctx);
      return (row) => {
        const titles = read(row)
          .map((id) => ctx.titleOf?.(id)?.trim() ?? '')
          .filter((title) => title !== '');
        return titles.length > 0 ? titles.join(', ') : null;
      };
    }
    case 'formula':
      return (row) => {
        const value = readCell(row, property);
        if (typeof value === 'number') return value;
        if (typeof value === 'boolean') return value ? 1 : 0;
        if (typeof value === 'string') return value.trim() === '' ? null : value;
        const date = readDateValue(value);
        if (!date) return null;
        return date.includeTime
          ? Date.parse(date.start)
          : startOfDayInstant(date.start, ctx.timeZone);
      };
  }
}

/** Compares two non-empty sort keys of the same property. */
export function compareSortKeys(a: SortKey, b: SortKey, collator: Intl.Collator): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  if (typeof a === 'string' && typeof b === 'string') return collator.compare(a, b);
  if (typeof a === 'number' && typeof b === 'number') return a < b ? -1 : a > b ? 1 : 0;
  if (Array.isArray(a) && Array.isArray(b)) {
    const length = Math.min(a.length, b.length);
    for (let i = 0; i < length; i += 1) {
      const diff = (a[i] ?? 0) - (b[i] ?? 0);
      if (diff !== 0) return diff < 0 ? -1 : 1;
    }
    return a.length - b.length;
  }
  // Mixed kinds cannot come from one reader; order them deterministically anyway.
  return typeof a < typeof b ? -1 : typeof a > typeof b ? 1 : 0;
}

/**
 * Dense ranks of a column of keys: equal keys share a rank, ranks start at 0 and empty keys get
 * -1. Each distinct key is compared O(log n) times instead of at every row comparison, which makes
 * collation cheap.
 */
function denseRanks(
  keys: readonly SortKey[],
  collator: Intl.Collator,
): { ranks: Int32Array; count: number } {
  const byIdentity = new Map<string | number, SortKey>();
  const identity = (key: Exclude<SortKey, null>) =>
    (Array.isArray(key) ? key.join(',') : key) as string | number;
  for (const key of keys) if (key !== null) byIdentity.set(identity(key), key);
  const distinct = [...byIdentity.values()].sort((a, b) => compareSortKeys(a, b, collator));
  const rankOf = new Map<string | number, number>();
  let rank = -1;
  distinct.forEach((key, index) => {
    const previous = distinct[index - 1];
    if (previous === undefined || compareSortKeys(previous, key, collator) !== 0) rank += 1;
    if (key !== null) rankOf.set(identity(key), rank);
  });
  const ranks = new Int32Array(keys.length);
  keys.forEach((key, index) => {
    ranks[index] = key === null ? -1 : (rankOf.get(identity(key)) ?? 0);
  });
  return { ranks, count: rank + 1 };
}

/**
 * Sorts rows by several rules (the first rule wins, later rules break ties). The sort is stable:
 * rows that compare equal keep their input order, which is the manual order. Rules on deleted
 * properties are skipped. Keys are computed once per row, so sorting 10,000 rows stays fast.
 *
 * @example
 * const sorted = sortRows(rows, [{ propertyId: dueId, direction: 'asc' }], properties, ctx);
 */
export function sortRows<R extends QueryRow>(
  rows: readonly R[],
  sorts: readonly SortRule[],
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
): R[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const rules = sorts.flatMap((sort) => {
    const property = byId.get(sort.propertyId);
    return property ? [{ property, direction: sort.direction === 'desc' ? -1 : 1 }] : [];
  });
  if (rules.length === 0 || rows.length < 2) return rows.slice();
  const collator = sortCollator(ctx.locale);
  const n = rows.length;
  // Per rule, a position in 0..count where empty values take `count` (last in both directions).
  const columns = rules.map(({ property, direction }) => {
    const read = sortKeyReader(property, ctx);
    const { ranks, count } = denseRanks(
      rows.map((row) => read(row)),
      collator,
    );
    const positions = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      const rank = ranks[i] ?? -1;
      positions[i] = rank < 0 ? count : direction === 1 ? rank : count - 1 - rank;
    }
    return { positions, base: count + 1 };
  });
  // Mixed-radix composite of every rule's position, then the input index: one number per row,
  // sorted natively. Falls back to a comparator when the composite would lose precision.
  const span = columns.reduce((product, column) => product * column.base, n);
  if (span < Number.MAX_SAFE_INTEGER) {
    const composite = new Float64Array(n);
    for (let i = 0; i < n; i += 1) {
      let key = 0;
      for (const column of columns) key = key * column.base + (column.positions[i] ?? 0);
      composite[i] = key * n + i;
    }
    composite.sort();
    const result: R[] = new Array<R>(n);
    for (let i = 0; i < n; i += 1) result[i] = rows[(composite[i] ?? 0) % n] as R;
    return result;
  }
  const indexes = rows.map((_, index) => index);
  indexes.sort((a, b) => {
    for (const column of columns) {
      const diff = (column.positions[a] ?? 0) - (column.positions[b] ?? 0);
      if (diff !== 0) return diff;
    }
    return a - b;
  });
  return indexes.map((index) => rows[index] as R);
}
