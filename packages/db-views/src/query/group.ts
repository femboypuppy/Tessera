import {
  EMPTY_GROUP_KEY,
  type GroupConfig,
  type PropertyDefinition,
  type SelectOption,
} from '@tessera/core';
import { readCell, readDateValue } from './cells';
import { dayKeyOfInstant, isoWeekKey, type DayKey } from './dates';
import { idListReader } from './filter';
import { sortCollator } from './text';
import type { QueryContext, QueryRow } from './types';

/** One group of rows (a board column, a table section). */
export interface RowGroup<R extends QueryRow = QueryRow> {
  /** The group key (see `GroupConfig` in core), {@link EMPTY_GROUP_KEY} for empty values. */
  key: string;
  rows: R[];
  /** The option of a select or multi-select group. */
  option?: SelectOption;
  /** True for the group of rows whose value is empty. */
  isEmpty: boolean;
  /** Listed in `GroupConfig.hidden`: views show it in a "Hidden groups" list. */
  hidden: boolean;
  /** Listed in `GroupConfig.collapsed`. */
  collapsed: boolean;
}

type Bucket = GroupConfig['dateBucket'];

function bucketOfDay(day: DayKey, bucket: Bucket): string {
  switch (bucket) {
    case 'day':
      return day;
    case 'week':
      return isoWeekKey(day);
    case 'month':
      return day.slice(0, 7);
    case 'year':
      return day.slice(0, 4);
  }
}

/**
 * The group keys of a row (a multi-select row belongs to every option it has):
 * option IDs, `'true'`/`'false'` for checkboxes, date buckets (`YYYY-MM-DD`, `YYYY-Www`,
 * `YYYY-MM`, `YYYY`) in the viewer's zone for dates (by the start of a range), the value as a
 * string otherwise, and {@link EMPTY_GROUP_KEY} for empty values.
 */
export function groupKeyReader(
  property: PropertyDefinition,
  config: Pick<GroupConfig, 'dateBucket'>,
  ctx: QueryContext,
): (row: QueryRow) => string[] {
  switch (property.type) {
    case 'select': {
      const known = new Set(property.options?.map((option) => option.id));
      return (row) => {
        const value = readCell(row, property);
        return [typeof value === 'string' && known.has(value) ? value : EMPTY_GROUP_KEY];
      };
    }
    case 'multiSelect': {
      const read = idListReader(property, ctx);
      return (row) => {
        const ids = read(row);
        return ids.length > 0 ? [...ids] : [EMPTY_GROUP_KEY];
      };
    }
    case 'relation': {
      const read = idListReader(property, ctx);
      return (row) => {
        const ids = read(row);
        return [ids.length > 0 ? ids.join(',') : EMPTY_GROUP_KEY];
      };
    }
    case 'checkbox':
      return (row) => [readCell(row, property) === true ? 'true' : 'false'];
    case 'date':
      return (row) => {
        const value = readDateValue(row.values[property.id]);
        if (!value) return [EMPTY_GROUP_KEY];
        const day = value.includeTime
          ? dayKeyOfInstant(Date.parse(value.start), ctx.timeZone)
          : value.start;
        return [bucketOfDay(day, config.dateBucket)];
      };
    case 'createdTime':
    case 'updatedTime':
      return (row) => {
        const ms = property.type === 'createdTime' ? row.createdAt : row.updatedAt;
        return [bucketOfDay(dayKeyOfInstant(ms, ctx.timeZone), config.dateBucket)];
      };
    case 'number':
      return (row) => {
        const value = readCell(row, property);
        return [typeof value === 'number' ? String(value) : EMPTY_GROUP_KEY];
      };
    case 'title':
    case 'text':
    case 'url':
    case 'email':
      return (row) => {
        const value = readCell(row, property);
        return [typeof value === 'string' && value.trim() !== '' ? value : EMPTY_GROUP_KEY];
      };
    case 'formula':
      return () => [EMPTY_GROUP_KEY];
  }
}

function naturalOrder(
  property: PropertyDefinition,
  keys: Iterable<string>,
  ctx: QueryContext,
): string[] {
  const list = [...keys].filter((key) => key !== EMPTY_GROUP_KEY);
  if (property.type === 'number') return list.sort((a, b) => Number(a) - Number(b));
  if (
    property.type === 'date' ||
    property.type === 'createdTime' ||
    property.type === 'updatedTime'
  ) {
    return list.sort();
  }
  const collator = sortCollator(ctx.locale);
  return list.sort((a, b) => collator.compare(a, b));
}

/**
 * Groups rows (already filtered and sorted; each group keeps that order).
 *
 * Natural group order: select and multi-select properties list the empty group first, then every
 * option in option order (options without rows included, like board columns); checkboxes list
 * unchecked then checked; dates list buckets chronologically and numbers numerically; everything
 * else sorts with the collator. Other types only have groups that hold rows, with the empty group
 * last. Keys in `config.order` come first, in that order. `hideEmptyGroups` drops groups without
 * rows; `hidden` and `collapsed` only flag groups (views decide how to show them).
 *
 * @example
 * const columns = groupRows(sortedRows, view.group, statusProperty, ctx);
 */
export function groupRows<R extends QueryRow>(
  rows: readonly R[],
  config: GroupConfig,
  property: PropertyDefinition,
  ctx: QueryContext,
): RowGroup<R>[] {
  const readKeys = groupKeyReader(property, config, ctx);
  const buckets = new Map<string, R[]>();
  for (const row of rows) {
    for (const key of readKeys(row)) {
      const bucket = buckets.get(key);
      if (bucket) bucket.push(row);
      else buckets.set(key, [row]);
    }
  }

  const options = new Map(property.options?.map((option) => [option.id, option]));
  let natural: string[];
  if (property.type === 'select' || property.type === 'multiSelect') {
    natural = [EMPTY_GROUP_KEY, ...(property.options ?? []).map((option) => option.id)];
  } else if (property.type === 'checkbox') {
    natural = ['false', 'true'];
  } else {
    natural = naturalOrder(property, buckets.keys(), ctx);
    if (buckets.has(EMPTY_GROUP_KEY)) natural.push(EMPTY_GROUP_KEY);
  }

  const available = new Set(natural);
  const ordered: string[] = [];
  const placed = new Set<string>();
  for (const key of config.order) {
    if (available.has(key) && !placed.has(key)) {
      ordered.push(key);
      placed.add(key);
    }
  }
  for (const key of natural) if (!placed.has(key)) ordered.push(key);

  const hidden = new Set(config.hidden);
  const collapsed = new Set(config.collapsed);
  const groups: RowGroup<R>[] = [];
  for (const key of ordered) {
    const groupRowsForKey = buckets.get(key) ?? [];
    if (config.hideEmptyGroups && groupRowsForKey.length === 0) continue;
    const group: RowGroup<R> = {
      key,
      rows: groupRowsForKey,
      isEmpty: key === EMPTY_GROUP_KEY,
      hidden: hidden.has(key),
      collapsed: collapsed.has(key),
    };
    const option = options.get(key);
    if (option) group.option = option;
    groups.push(group);
  }
  return groups;
}
