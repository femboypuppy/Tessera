import { expect, test as base } from '../support';
import { createPage, createWorkspace, pageTree } from '../architect/helpers';
import {
  ensureExamplesBuilt,
  expectNoEscape,
  installFromRegistry,
  openPanel,
  openPluginSettings,
  pluginFrame,
  serveRegistry,
} from './support';

/**
 * The app as a Tessera server serves it, under the server's Content-Security-Policy (the preview
 * server the other specs use sends none). Plugin frames are `srcdoc` documents, which inherit the
 * app's policy on top of their own, so the app's policy must let their bootstrap run.
 */
const test = base.extend({
  baseURL: async ({ syncServer }, provide) => {
    await provide(syncServer.url);
  },
});

// Each test installs a plugin in a fresh workspace: slow in Firefox on a busy machine.
test.describe.configure({ timeout: 120_000 });

test.beforeAll(async () => {
  test.setTimeout(600_000);
  await ensureExamplesBuilt();
});

test('plugins run in the app served by a Tessera server, under its CSP', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (message) => {
    if (/Content Security Policy|Content-Security-Policy/i.test(message.text()))
      violations.push(message.text());
  });
  await serveRegistry(page);
  const index = await page.request.get('/');
  expect(index.headers()['content-security-policy']).toMatch(
    /script-src 'self' 'nonce-[^']+' blob:/,
  );

  await createWorkspace(page, 'Served');
  await createPage(page, 'Mission log');
  await openPluginSettings(page);
  await installFromRegistry(page, 'Word count');
  await expect(page.getByText('Running', { exact: true })).toBeVisible({ timeout: 30_000 });

  await pageTree(page).getByRole('treeitem', { name: 'Mission log' }).click();
  await openPanel(page, 'Word count');
  const panel = pluginFrame(page, 'Word count panel');
  await expect(panel.getByTestId('word-count')).toHaveText('0', { timeout: 20_000 });
  await page.getByRole('textbox', { name: 'Page title' }).press('Enter');
  await page.keyboard.type('Houston, the Eagle has landed');
  await expect(panel.getByTestId('word-count')).toHaveText('5', { timeout: 10_000 });
  expect(violations).toEqual([]);
});

test('a malicious plugin reaches nothing outside its sandbox under the server CSP', async ({
  page,
  context,
}) => {
  await expectNoEscape(page, context);
});
