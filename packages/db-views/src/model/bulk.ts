import {
  DATABASE_DOC_KEYS,
  InvalidOperationError,
  NotFoundError,
  ValidationError,
  isStoredPropertyType,
  isValidIcon,
  listProperties,
  listRows,
  newId,
  normalizeTitle,
  ordersBetween,
  type AppContext,
  type JsonValue,
  type PropertyDefinition,
} from '@tessera/core';
import * as Y from 'yjs';
import { isValidStoredValue } from '../query/cells';

/*
 * LOCAL WORKAROUND for Contract change request 1 (HANDOFF/databases.md).
 *
 * `createPage` and `addRow` in core rebuild the page index and re-read every row on each call,
 * so adding n rows costs O(n²): 3,000 rows take about 18 seconds and 10,000 several minutes. CSV
 * imports, pasting many rows and the 10,000-row performance test need a bulk path. Until core
 * ships `createPages`/`addRows` (the request), this module writes exactly the structures those
 * helpers write (SPEC 4.3 and 4.5: the `pages` map of the workspace doc, the `rows` map of the
 * database doc), after validating every input the way they do. `bulk.test.ts` proves the result
 * reads back identically through core's readers. Replace the body with the core helpers when the
 * request lands; the signature stays.
 */

/** One row to add. */
export interface BulkRowInput {
  title?: string;
  icon?: string;
  values?: Record<string, JsonValue | null | undefined>;
}

/** Options of {@link addRowsInBulk}. */
export interface BulkRowOptions {
  /** Insert right after this row (manual order); default: at the end. */
  after?: string | null;
  now?: number;
}

/** The workspace doc's page map key (SPEC 4.3). */
const PAGES_KEY = 'pages';

function checkValues(
  values: BulkRowInput['values'],
  properties: ReadonlyMap<string, PropertyDefinition>,
): Array<[string, JsonValue]> {
  const result: Array<[string, JsonValue]> = [];
  for (const [propertyId, value] of Object.entries(values ?? {})) {
    if (value === null || value === undefined) continue;
    const property = properties.get(propertyId);
    if (!property) throw new NotFoundError('Property', propertyId);
    if (!isStoredPropertyType(property.type)) {
      throw new InvalidOperationError(`"${property.type}" values are not stored in rows`);
    }
    if (!isValidStoredValue(property.type, value)) {
      throw new ValidationError(`Invalid value for "${property.name}"`);
    }
    if (property.type === 'select' || property.type === 'multiSelect') {
      const known = new Set(property.options?.map((option) => option.id));
      const ids = Array.isArray(value) ? value : [value];
      if (ids.some((id) => typeof id !== 'string' || !known.has(id))) {
        throw new ValidationError(`Unknown option for "${property.name}"`);
      }
    }
    result.push([propertyId, value]);
  }
  return result;
}

function lastOrder(orders: Iterable<string>): string | null {
  let last: string | null = null;
  for (const order of orders) if (last === null || order > last) last = order;
  return last;
}

/**
 * Adds many rows to a database at once: their pages in one workspace transaction and their
 * entries in one database transaction. Validates everything first, like `addDatabaseRow`, and
 * returns the new row IDs in order.
 *
 * @example
 * const ids = addRowsInBulk(ctx, handle.doc, databaseId, csvRows.map((values) => ({ title: values.name, values })));
 */
export function addRowsInBulk(
  ctx: Pick<AppContext, 'workspace' | 'currentUser'>,
  db: Y.Doc,
  databaseId: string,
  inputs: readonly BulkRowInput[],
  options: BulkRowOptions = {},
): string[] {
  if (inputs.length === 0) return [];
  const snapshot = ctx.workspace.pages.getSnapshot();
  const database = snapshot.get(databaseId);
  if (!database || database.kind !== 'database') throw new NotFoundError('Database', databaseId);
  if (snapshot.isTrashed(databaseId)) {
    throw new InvalidOperationError('Cannot add rows to a database that is in the trash');
  }
  const properties = new Map(listProperties(db).map((property) => [property.id, property]));
  const prepared = inputs.map((input) => ({
    id: newId(),
    title: normalizeTitle(input.title ?? ''),
    icon: input.icon !== undefined && isValidIcon(input.icon) ? input.icon : undefined,
    values: checkValues(input.values, properties),
  }));

  // Order keys: pages after every child of the database; rows after the anchor or at the end.
  const children = snapshot.children(databaseId, { includeRows: true, includeTrashed: true });
  const pageOrders = ordersBetween(
    lastOrder(children.map((page) => page.order)),
    null,
    prepared.length,
  );
  const rows = listRows(db);
  let rowOrders: string[];
  const anchorIndex = options.after ? rows.findIndex((row) => row.id === options.after) : -1;
  const anchor = rows[anchorIndex];
  const next = rows[anchorIndex + 1];
  try {
    rowOrders = anchor
      ? ordersBetween(anchor.order, next?.order ?? null, prepared.length)
      : ordersBetween(lastOrder(rows.map((row) => row.order)), null, prepared.length);
  } catch {
    rowOrders = ordersBetween(lastOrder(rows.map((row) => row.order)), null, prepared.length);
  }

  const now = options.now ?? Date.now();
  const userId = ctx.currentUser.id;
  const pagesMap = ctx.workspace.doc.getMap<unknown>(PAGES_KEY);
  ctx.workspace.doc.transact(() => {
    prepared.forEach((row, index) => {
      if (pagesMap.has(row.id)) throw new InvalidOperationError(`Page "${row.id}" already exists`);
      const map = new Y.Map<unknown>();
      map.set('kind', 'page');
      map.set('title', row.title);
      map.set('parentId', databaseId);
      map.set('order', pageOrders[index] ?? 'a0');
      map.set('createdAt', now);
      map.set('updatedAt', now);
      if (userId) {
        map.set('createdBy', userId);
        map.set('updatedBy', userId);
      }
      if (row.icon) map.set('icon', row.icon);
      pagesMap.set(row.id, map);
    });
  });
  const rowsMap = db.getMap<unknown>(DATABASE_DOC_KEYS.rows);
  db.transact(() => {
    prepared.forEach((row, index) => {
      const map = new Y.Map<unknown>();
      map.set('order', rowOrders[index] ?? 'a0');
      map.set('values', new Y.Map<unknown>());
      rowsMap.set(row.id, map);
      const values = map.get('values') as Y.Map<unknown>;
      for (const [propertyId, value] of row.values) values.set(propertyId, value);
      map.set('valuesUpdatedAt', now);
      if (userId) map.set('valuesUpdatedBy', userId);
    });
  });
  return prepared.map((row) => row.id);
}
