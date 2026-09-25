/**
 * Imported first by `main.tsx`, before any schema is parsed. Zod compiles object parsers with
 * `new Function` unless told not to, after probing whether `eval` works. The app's CSP forbids
 * `eval` (the server's and the desktop app's), so the probe only produced a CSP violation there:
 * validation takes the same eval-free path everywhere.
 *
 * Zod keeps its configuration on `globalThis.__zod_globalConfig` (shared by every copy of zod, and
 * read when a schema parses), so setting it there keeps zod itself out of the startup bundle: the
 * schemas load on demand. `zod-config.test.ts` checks that zod still reads it.
 */
const scope = globalThis as { __zod_globalConfig?: { jitless?: boolean } };
scope.__zod_globalConfig ??= {};
scope.__zod_globalConfig.jitless = true;

export {};
