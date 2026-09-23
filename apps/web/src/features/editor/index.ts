import { defineFeature } from '@tessera/core';

/**
 * Editor (Agent 02). Registers the `page` body (`pageBodies.page`), the `web` block renderer, editor extensions and editor commands; components and logic live in `@tessera/editor`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const editorFeature = defineFeature({ id: 'editor' });
