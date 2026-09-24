import {
  addProperty,
  getTitleProperty,
  listProperties,
  updateProperty,
  type AppContext,
  type JsonValue,
  type PageMeta,
  type PropertyDefinition,
} from '@tessera/core';
import { columnOptions, type ColumnPlan, type CsvTable } from '../csv/csv';
import { parseCellText } from '../query/parse';
import type { QueryContext } from '../query/types';
import { addRowsInBulk } from './bulk';
import { createDatabase } from './operations';

/** Where and how to import. */
export interface CsvImportOptions {
  title: string;
  parentId?: string | null;
}

/**
 * Creates a database from a parsed CSV file: the title column names the title property, every
 * other column becomes a property of its planned type (select options in order of first
 * appearance), and every row becomes a row, all in a few transactions. Cells that do not parse
 * for their column's type are left empty.
 *
 * @example
 * const table = parseCsv(text);
 * const { page } = await importCsvAsDatabase(ctx, table, inferColumns(table, qctx), { title: 'Books' }, qctx);
 */
export async function importCsvAsDatabase(
  ctx: Pick<AppContext, 'workspace' | 'loadDatabaseDoc' | 'loadPageDoc' | 'currentUser'>,
  table: CsvTable,
  plans: readonly ColumnPlan[],
  options: CsvImportOptions,
  queryCtx: Pick<QueryContext, 'timeZone'>,
): Promise<{ page: PageMeta; rowCount: number }> {
  const { page } = await createDatabase(ctx, {
    title: options.title,
    parentId: options.parentId ?? null,
    fullWidth: true,
  });
  const handle = await ctx.loadDatabaseDoc(page.id);
  try {
    const db = handle.doc;
    const titlePlan = plans.find((plan) => plan.type === 'title');
    const byColumn = new Map<number, PropertyDefinition>();
    db.transact(() => {
      const title = getTitleProperty(db);
      if (title && titlePlan) {
        updateProperty(db, title.id, { name: titlePlan.name });
        byColumn.set(titlePlan.index, { ...title, name: titlePlan.name });
      }
      for (const plan of plans) {
        if (plan.type === 'title') continue;
        const input: Parameters<typeof addProperty>[1] = { name: plan.name, type: plan.type };
        if (plan.number) input.number = plan.number;
        if (plan.type === 'select' || plan.type === 'multiSelect') {
          input.options = columnOptions(table, plan).map((name) => ({ name }));
        }
        const property = addProperty(db, input);
        byColumn.set(plan.index, property);
      }
    });
    const properties = new Map(listProperties(db).map((property) => [property.id, property]));
    const optionIds = new Map<string, Map<string, string>>();
    for (const property of properties.values()) {
      optionIds.set(
        property.id,
        new Map(property.options?.map((option) => [option.name.trim().toLowerCase(), option.id])),
      );
    }
    const rows = table.rows.map((cells) => {
      let title = '';
      const values: Record<string, JsonValue> = {};
      for (const plan of plans) {
        const property = byColumn.get(plan.index);
        const text = cells[plan.index] ?? '';
        if (!property) continue;
        const current = properties.get(property.id) ?? property;
        const parsed = parseCellText(text, current, queryCtx, { dayFirst: plan.dayFirst ?? false });
        switch (parsed.kind) {
          case 'title':
            title = parsed.title;
            break;
          case 'value':
            if (parsed.value !== null) values[current.id] = parsed.value;
            break;
          case 'options': {
            const ids = optionIds.get(current.id);
            const found = parsed.names
              .map((name) => ids?.get(name.trim().toLowerCase()))
              .filter((id): id is string => !!id);
            if (found.length > 0)
              values[current.id] = current.type === 'select' ? (found[0] ?? '') : found;
            break;
          }
          default:
            break;
        }
      }
      return { title, values };
    });
    addRowsInBulk(ctx, db, page.id, rows);
    return { page, rowCount: rows.length };
  } finally {
    handle.release();
  }
}
