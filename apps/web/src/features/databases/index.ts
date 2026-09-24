import { defineFeature, type AppContext } from '@tessera/core';
import { DatabaseOverlayHost, NewDatabaseSidebarItem, overlays, tCore } from '@tessera/db-views';
import { Database, Download, FileUp, Table2 } from 'lucide-react';
import { lazy } from 'react';

/**
 * Databases (Agent 04). Registers the `database` page body, row properties and "Linked from" as
 * page top sections, the `database` embed with its slash-menu entries, the side peek and CSV
 * import overlays, a "New database" sidebar button and commands. Everything heavy lives in
 * `@tessera/db-views` and loads on demand.
 */

const DatabaseBody = lazy(() => import('@tessera/db-views/database-body'));
const RowProperties = lazy(() => import('@tessera/db-views/row-properties'));
const LinkedFrom = lazy(() => import('@tessera/db-views/linked-from'));
const InlineDatabase = lazy(() => import('@tessera/db-views/inline-database'));
const loadActions = () => import('@tessera/db-views/actions');

const isRow = (pageId: string, ctx: AppContext) => ctx.workspace.pages.getSnapshot().isRow(pageId);

/** IDs of the commands this feature registers. */
export const DATABASE_COMMANDS = {
  newDatabase: 'databases.newDatabase',
  importCsv: 'databases.importCsv',
  exportCsv: 'databases.exportCsv',
} as const;

export const databasesFeature = defineFeature({
  id: 'databases',
  pageBodies: { database: DatabaseBody },
  pageTopSections: [
    {
      id: 'databases.rowProperties',
      order: 0,
      when: (page, ctx) => isRow(page.id, ctx),
      component: RowProperties,
    },
    { id: 'databases.linkedFrom', order: 10, component: LinkedFrom },
  ],
  blockRenderers: [
    {
      kind: 'database',
      label: tCore('databaseBlock'),
      component: InlineDatabase,
      slashMenu: [
        {
          id: 'databases.inline',
          title: tCore('inlineDatabase'),
          description: tCore('inlineDatabaseDescription'),
          keywords: ['database', 'table', 'inline', 'db'],
          icon: Table2,
          group: 'database',
          create: async ({ app, pageId }) => {
            const { createDatabase } = await import('@tessera/db-views/operations');
            const { page, viewId } = await createDatabase(app, { parentId: pageId, title: '' });
            return { kind: 'database', ref: page.id, data: { viewId } };
          },
        },
        {
          id: 'databases.linked',
          title: tCore('linkedView'),
          description: tCore('linkedViewDescription'),
          keywords: ['database', 'linked', 'view', 'db'],
          icon: Database,
          group: 'database',
          create: async () => {
            const choice = await overlays.pickDatabase();
            return choice
              ? { kind: 'database', ref: choice.databaseId, data: { viewId: choice.viewId } }
              : null;
          },
        },
      ],
    },
  ],
  sidebarSections: [
    { id: 'databases.new', position: 'top', order: -10, component: NewDatabaseSidebarItem },
  ],
  overlays: [{ id: 'databases.overlays', component: DatabaseOverlayHost }],
  commands: [
    {
      id: DATABASE_COMMANDS.newDatabase,
      title: tCore('newDatabase'),
      group: 'page',
      icon: Database,
      keywords: ['table', 'database', 'board', 'calendar'],
      run: ({ app }) => loadActions().then(({ newDatabaseAndOpen }) => newDatabaseAndOpen(app)),
    },
    {
      id: DATABASE_COMMANDS.importCsv,
      title: tCore('importCsv'),
      group: 'workspace',
      icon: FileUp,
      keywords: ['csv', 'spreadsheet', 'import'],
      run: () => overlays.openCsvImport(null),
    },
    {
      id: DATABASE_COMMANDS.exportCsv,
      title: tCore('exportCsv'),
      group: 'page',
      icon: Download,
      keywords: ['csv', 'spreadsheet', 'export', 'download'],
      when: ({ app, pageId }) => !!pageId && app.workspace.getPage(pageId)?.kind === 'database',
      run: ({ app, pageId }) =>
        pageId
          ? loadActions().then(({ exportDatabaseCsv }) => exportDatabaseCsv(app, pageId))
          : undefined,
    },
  ],
  activate(ctx) {
    // Permanent deletions leave dangling relation values: clean them up (only the client that
    // deleted does it; the edits sync to everyone).
    let deleted = new Set<string>();
    let deletedDatabases = new Set<string>();
    let scheduled = false;
    const offDeleted = ctx.events.on('page.deleted', ({ pageId, page, local }) => {
      if (!local) return;
      deleted.add(pageId);
      if (page.kind === 'database') deletedDatabases.add(pageId);
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => {
        const ids = deleted;
        const databases = deletedDatabases;
        deleted = new Set();
        deletedDatabases = new Set();
        scheduled = false;
        void loadActions()
          .then(({ cleanUpAfterDeletion }) => cleanUpAfterDeletion(ctx, ids, databases))
          .catch((error: unknown) => console.error('[databases] relation cleanup failed', error));
      });
    });
    const offChanged = ctx.events.on('database.changed', ({ databaseId }) => {
      void loadActions()
        .then(({ refreshBackReferences }) => refreshBackReferences(ctx, databaseId))
        .catch((error: unknown) => console.error('[databases] linked-from refresh failed', error));
    });
    return () => {
      offDeleted();
      offChanged();
      overlays.reset();
    };
  },
});
