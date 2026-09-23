import { defineFeature } from '@tessera/core';

/**
 * Databases (Agent 04). Registers the `database` body (`pageBodies.database`), row properties (`pageTopSections`), the `database` block renderer and its slash-menu entries; logic lives in `@tessera/db-views`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const databasesFeature = defineFeature({ id: 'databases' });
