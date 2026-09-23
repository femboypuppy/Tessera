import { defineFeature } from '@tessera/core';

/**
 * Graph view (Agent 05). Registers the `/graph` route and the local-graph side panel (`PANELS.localGraph`); logic lives in `@tessera/search`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const graphFeature = defineFeature({ id: 'graph' });
