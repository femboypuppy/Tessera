import { defineFeature } from '@tessera/core';

/**
 * Search & command palette (Agent 05). Registers the MiniSearch SearchIndex (priority 50), the command palette (`COMMANDS.openPalette`, Mod+K), `COMMANDS.search` and the `/search` route; logic lives in `@tessera/search`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const searchFeature = defineFeature({ id: 'search' });
