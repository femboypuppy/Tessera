import type { PluginManifest } from '@tessera/core';

/**
 * @tessera/plugin-api — the SDK plugin authors use (Agent 06).
 *
 * The real API object (`api.commands`, `api.ui`, `api.pages`, …) is built by Agent 06 on top of the
 * contracts in `@tessera/core`. See HANDOFF/architect.md.
 */
export const PLUGIN_API_PACKAGE = '@tessera/plugin-api';

/** Re-exported so plugin authors can type their manifest. */
export type { PluginManifest };
