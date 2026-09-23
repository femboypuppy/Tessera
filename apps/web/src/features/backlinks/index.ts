import { defineFeature } from '@tessera/core';

/**
 * Backlinks (Agent 05). Registers the graph LinkIndex (priority 50), the backlinks side panel (`PANELS.backlinks`) and the optional backlinks footer; logic lives in `@tessera/search`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const backlinksFeature = defineFeature({ id: 'backlinks' });
