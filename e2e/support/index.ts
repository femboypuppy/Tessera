/**
 * Shared end-to-end support: import `test` and `expect` from here instead of `@playwright/test`
 * to get Tessera's fixtures (`app`, `freshWorkspace`, `seededWorkspace`, `syncServer`,
 * `collaborators`), feature detection for journeys, and axe checks. They live in
 * `@tessera/testkit/playwright`; the relative import keeps `e2e/` free of a package.json.
 *
 * @example
 * import { expect, test } from '../support';
 *
 * test('search finds a page', async ({ freshWorkspace: app }) => {
 *   await app.expectFeatures('search');
 *   …
 * });
 */
export * from '../../packages/testkit/src/playwright';
