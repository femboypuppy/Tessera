import type { PropertyDefinition, ViewConfig } from '@tessera/core';
import { compileFilter } from './filter';
import { withFormulaValues } from './formula/rows';
import { groupRows, type RowGroup } from './group';
import { compileSearch, type SearchCache } from './search';
import { sortRows } from './sort';
import type { QueryContext, QueryRow } from './types';

/** The parts of a view the query reads. */
export type QueryView = Pick<ViewConfig, 'filter' | 'sorts' | 'group'>;

/** Options of {@link runQuery}. */
export interface RunQueryOptions {
  /** Search text (the database search box). */
  search?: string;
  /** Reused between runs while rows and properties are unchanged. */
  searchCache?: SearchCache;
  /** Set false to skip grouping even when the view groups (list, gallery, calendar). */
  group?: boolean;
}

/** What a view shows. */
export interface QueryResult<R extends QueryRow = QueryRow> {
  /** Filtered, searched and sorted rows. */
  rows: R[];
  /** Groups of `rows` (null when the view does not group or its property is gone). */
  groups: RowGroup<R>[] | null;
  /** Rows before filtering and searching (trashed and missing pages excluded). */
  total: number;
}

/**
 * Runs a view's query: drops rows whose page is trashed or missing, computes formulas, filters,
 * searches, sorts (stable, manual order last) and groups. Result rows carry their formula values
 * (`row.formulas`). Pure and framework-free: views, plugins and exporters
 * all call it with the same result.
 *
 * @example
 * const { rows, groups } = runQuery(resolveRows(listRows(db), pages), listProperties(db), view, createQueryContext());
 */
export function runQuery<R extends QueryRow>(
  rows: readonly R[],
  properties: readonly PropertyDefinition[],
  view: QueryView,
  ctx: QueryContext,
  options: RunQueryOptions = {},
): QueryResult<R> {
  const live = withFormulaValues(
    rows.filter((row) => !row.trashed && !row.missingPage),
    properties,
    ctx,
  );
  const filter = compileFilter(view.filter, properties, ctx);
  const search = options.search
    ? compileSearch(options.search, properties, ctx, options.searchCache)
    : null;
  const matched =
    filter || search
      ? live.filter((row) => (!filter || filter(row)) && (!search || search(row)))
      : live;
  const sorted = sortRows(matched, view.sorts, properties, ctx);
  let groups: RowGroup<R>[] | null = null;
  if (options.group !== false && view.group) {
    const property = properties.find((candidate) => candidate.id === view.group?.propertyId);
    if (property) groups = groupRows(sorted, view.group, property, ctx);
  }
  return { rows: sorted, groups, total: live.length };
}
