import type { PropertyDefinition, PropertyType } from '@tessera/core';
import { readCell } from './cells';
import type { RowPredicate } from './filter';
import { cellTextFormatter } from './format';
import { foldText } from './text';
import type { QueryContext, QueryRow } from './types';

/** Property types whose text the database search looks at. */
export const SEARCHABLE_TYPES: readonly PropertyType[] = [
  'title',
  'text',
  'url',
  'email',
  'number',
  'select',
  'multiSelect',
  'date',
  'relation',
];

/** A cache of folded row text; reuse it while the rows and properties stay the same. */
export type SearchCache = WeakMap<QueryRow, string>;

/**
 * Compiles a search inside a database: every word must appear (case- and accent-insensitive) in
 * the title or in a searchable property. Returns null for an empty query.
 *
 * @example
 * const test = compileSearch('apollo lunar', properties, ctx);
 */
export function compileSearch(
  query: string,
  properties: readonly PropertyDefinition[],
  ctx: QueryContext,
  cache?: SearchCache,
): RowPredicate | null {
  const terms = foldText(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return null;
  const searchable = properties
    .filter((property) => SEARCHABLE_TYPES.includes(property.type))
    .map((property) => ({ property, text: cellTextFormatter(property, ctx) }));
  const haystack = (row: QueryRow): string => {
    const hit = cache?.get(row);
    if (hit !== undefined) return hit;
    let joined = '';
    for (const { property, text } of searchable) {
      const part = text(readCell(row, property));
      if (part) joined = joined ? `${joined}\n${part}` : part;
    }
    const folded = foldText(joined);
    cache?.set(row, folded);
    return folded;
  };
  return (row) => {
    const text = haystack(row);
    for (const term of terms) if (!text.includes(term)) return false;
    return true;
  };
}
