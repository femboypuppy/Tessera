import { createTranslator } from '@tessera/ui';

/**
 * The strings the feature registration needs at startup (command titles, slash-menu entries, the
 * sidebar button). Everything else lives in `en.ts`, which loads with the views.
 */
export const enCore = {
  newDatabase: 'New database',
  importCsv: 'Import CSV as database',
  exportCsv: 'Export view as CSV',
  inlineDatabase: 'Database – inline',
  inlineDatabaseDescription: 'A table that lives inside this page',
  linkedView: 'Linked view of database',
  linkedViewDescription: 'Show a view of a database you already have',
  databaseBlock: 'Database',
  rowProperties: 'Properties',
  newRow: 'New row',
  databases: 'Databases',
  moreDatabaseActions: 'More database actions',
} as const;

/** `t` for the startup strings of the `db-views` namespace. */
export const tCore = createTranslator('db-views', enCore);
