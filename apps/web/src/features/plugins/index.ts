import { defineFeature } from '@tessera/core';

/**
 * Plugins (Agent 06). Registers the plugin host, the "Plugins" settings panel, the `plugin:` block renderer prefix and plugin panels (registered at runtime through `ctx.contributions`); logic lives in `@tessera/plugins`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const pluginsFeature = defineFeature({ id: 'plugins' });
