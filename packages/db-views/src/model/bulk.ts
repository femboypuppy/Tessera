import {
  addRows,
  checkRowValues,
  createPages,
  deletePagePermanently,
  isValidIcon,
  NotFoundError,
  type AppContext,
  type CreatePagesInput,
  type JsonValue,
} from '@tessera/core';
import type * as Y from 'yjs';

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

/** The stored values of a row: no empty entries. */
function valuesOf(input: BulkRowInput): Record<string, JsonValue> {
  const values: Record<string, JsonValue> = {};
  for (const [propertyId, value] of Object.entries(input.values ?? {})) {
    if (value !== null && value !== undefined) values[propertyId] = value;
  }
  return values;
}

/**
 * Adds many rows to a database at once, synchronously: their pages in one workspace transaction
 * (core's `createPages`) and their entries in one database transaction (`addRows`), after
 * validating every value. Returns the new row IDs in order. `ctx.workspace.addDatabaseRows` does
 * the same when the database doc isn't loaded yet.
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
  const database = ctx.workspace.getPage(databaseId);
  if (!database || database.kind !== 'database') throw new NotFoundError('Database', databaseId);
  const values = inputs.map(valuesOf);
  // Values first, so a bad one creates no pages.
  for (const row of values) checkRowValues(db, row);
  const mutation = { userId: ctx.currentUser.id, ...(options.now ? { now: options.now } : {}) };
  const pages = createPages(
    ctx.workspace.doc,
    inputs.map((input) => {
      const page: CreatePagesInput = { title: input.title ?? '', parentId: databaseId };
      // An icon that isn't a single emoji is dropped, as the CSV import and paste expect.
      if (input.icon !== undefined && isValidIcon(input.icon)) page.icon = input.icon;
      return page;
    }),
    mutation,
  );
  try {
    addRows(
      db,
      pages.map((page, index) => ({ id: page.id, values: values[index] ?? {} })),
      { ...mutation, after: options.after ?? null },
    );
  } catch (error) {
    ctx.workspace.doc.transact(() => {
      for (const page of pages) deletePagePermanently(ctx.workspace.doc, page.id, mutation);
    });
    throw error;
  }
  return pages.map((page) => page.id);
}
