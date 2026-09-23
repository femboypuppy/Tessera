import { PLUGIN_API_VERSION } from '@tessera/core';

/**
 * create-tessera-plugin — the plugin scaffolder (Agent 06).
 *
 * `pnpm create tessera-plugin my-plugin` writes a manifest, source, a Vite library build, a test
 * harness with a mocked API and a README. The npm name must stay `create-tessera-plugin` for
 * `pnpm create tessera-plugin` to find it. See HANDOFF/architect.md.
 */
export const CREATE_PLUGIN_PACKAGE = 'create-tessera-plugin';

/** The plugin API version new plugins declare in their manifest (`apiVersion`). */
export const TEMPLATE_API_VERSION = PLUGIN_API_VERSION;
