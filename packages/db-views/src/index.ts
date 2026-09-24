/**
 * @tessera/db-views — databases: the query engine and the table, board, calendar, gallery and
 * list views (Agent 04).
 *
 * This entry stays small because the feature registration (`apps/web/src/features/databases`)
 * imports it at startup: the overlay host, the sidebar buttons, the overlay store and the startup
 * strings. Views, editors and CSV load through the subpath entries:
 *
 * - `@tessera/db-views/query`: the pure query engine (plugins and exporters reuse it)
 * - `@tessera/db-views/csv`: CSV parsing, type inference and export
 * - `@tessera/db-views/database-body`, `/row-properties`, `/linked-from`, `/inline-database`:
 *   the lazily loaded components the feature registers
 * - `@tessera/db-views/actions`: what commands run
 */
export const DB_VIEWS_PACKAGE = '@tessera/db-views';

export { DatabaseOverlayHost, NewDatabaseSidebarItem } from './shell';
export { overlays, useOverlays, type OverlayState } from './overlay-store';
export { tCore } from './i18n/core';
