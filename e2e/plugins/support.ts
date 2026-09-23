import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type FrameLocator, type Page } from '@playwright/test';
import { buildExamples } from '../../packages/plugins/scripts/build-examples';
import { readDiagnostics } from '../architect/helpers';

/** Helpers for the plugin specs. */

const REPO = fileURLToPath(new URL('../../', import.meta.url));
const EXAMPLES = `${REPO}examples/plugins/`;
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const LOCK = `${EXAMPLES}.e2e-build-lock`;

/** Where the default registry and the example zips are published (served locally in tests). */
export const REGISTRY_BASE = 'https://femboypuppy.github.io/Tessera/plugins/';
/** Test-only plugins in e2e/plugins/fixtures, served under this origin. */
export const FIXTURE_BASE = 'https://fixtures.tessera.test/';

/**
 * Builds the example plugins once for every worker (a lock folder keeps parallel workers from
 * building at the same time; up-to-date examples are skipped).
 */
export async function ensureExamplesBuilt(): Promise<void> {
  for (;;) {
    try {
      mkdirSync(LOCK);
      break;
    } catch {
      // Another worker is building. A lock older than 10 minutes is stale.
      if (existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 600_000) rmdirSync(LOCK);
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  try {
    await buildExamples(undefined, { force: false });
  } finally {
    rmdirSync(LOCK);
  }
}

const headers = { 'access-control-allow-origin': '*' };

/** Serves the example registry and the built example zips at their published addresses. */
export async function serveRegistry(page: Page): Promise<void> {
  const registry = JSON.parse(readFileSync(`${EXAMPLES}registry.json`, 'utf8')) as {
    plugins: Array<{ id: string; version: string }>;
  };
  await page.route(`${REGISTRY_BASE}**`, async (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop() ?? '';
    if (name === 'registry.json') {
      await route.fulfill({ path: `${EXAMPLES}registry.json`, headers });
      return;
    }
    const plugin = registry.plugins.find((entry) => name === `${entry.id}-${entry.version}.zip`);
    if (!plugin) {
      await route.fulfill({ status: 404, headers, body: '' });
      return;
    }
    await route.fulfill({ path: exampleZip(plugin.id, plugin.version), headers });
  });
}

/** The built folder of an example plugin (`manifest.json`, `main.js`, `README.md`). */
export function exampleDist(id: string): string {
  return `${EXAMPLES}${id}/dist`;
}

/** The built zip of an example plugin. */
export function exampleZip(id: string, version = '1.0.0'): string {
  return `${EXAMPLES}${id}/dist/${id}-${version}.zip`;
}

/** The text of a fixture file, or null when there is none. */
export function fixtureText(name: string, file: string): string | null {
  if (!/^[a-z-]+$/.test(name) || !/^[a-z.]+$/.test(file)) return null;
  const path = `${FIXTURES}${name}/${file}`;
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

/** Serves e2e/plugins/fixtures/<name>/<file> at FIXTURE_BASE, optionally rewriting the text. */
export async function serveFixtures(
  page: Page,
  rewrite: (name: string, file: string, text: string) => string = (_n, _f, text) => text,
): Promise<void> {
  await page.route(`${FIXTURE_BASE}**`, async (route) => {
    const [, name = '', file = ''] = new URL(route.request().url()).pathname.split('/');
    const path = `${FIXTURES}${name}/${file}`;
    if (!/^[a-z-]+$/.test(name) || !/^[a-z.]+$/.test(file) || !existsSync(path)) {
      await route.fulfill({ status: 404, headers, body: '' });
      return;
    }
    await route.fulfill({
      body: rewrite(name, file, readFileSync(path, 'utf8')),
      headers: {
        ...headers,
        'content-type': file.endsWith('.js') ? 'text/javascript' : 'application/json',
      },
    });
  });
}

/** Opens Settings → Plugins without reloading (the workspace lives in memory until sync lands). */
export async function openPluginSettings(page: Page): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await page.getByRole('button', { name: 'Plugins', exact: true }).click();
  // The settings UI loads on demand (slow on a cold dev server).
  await expect(page.getByRole('button', { name: 'Install plugin' })).toBeVisible({
    timeout: 30_000,
  });
}

/** Approves the permission prompt that is open. */
export async function approvePrompt(page: Page, pluginName: string): Promise<void> {
  const prompt = page.getByRole('dialog', { name: `Install ${pluginName}?` });
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await prompt.getByRole('button', { name: 'Install', exact: true }).click();
  // `exact`: the toast's text is also announced in a live region ("Notifications …").
  await expect(page.getByText(`${pluginName} is installed`, { exact: true })).toBeVisible({
    timeout: 30_000,
  });
}

/** Installs a plugin from the Browse tab (Settings → Plugins must be open). */
export async function installFromRegistry(page: Page, pluginName: string): Promise<void> {
  await page.getByRole('tab', { name: 'Browse' }).click();
  await page.getByRole('button', { name: `Install ${pluginName}` }).click();
  await approvePrompt(page, pluginName);
}

/** Installs a plugin from a URL (Settings → Plugins must be open). */
export async function installFromUrl(page: Page, url: string, pluginName: string): Promise<void> {
  await page.getByRole('button', { name: 'Install plugin' }).click();
  await page.getByRole('menuitem', { name: 'From a URL…' }).click();
  await page.getByLabel('Plugin URL').fill(url);
  await page.getByRole('button', { name: 'Continue' }).click();
  await approvePrompt(page, pluginName);
}

/** The inner frame of a plugin panel or block, where the plugin's own UI runs. */
export function pluginFrame(page: Page, titlePrefix: string): FrameLocator {
  return page
    .frameLocator(`iframe[data-plugin-frame="ui"][title^="${titlePrefix}"]`)
    .frameLocator('iframe');
}

/** Waits until a command registered by a plugin is available. */
export async function expectCommand(page: Page, commandId: string, present = true): Promise<void> {
  await expect
    .poll(async () => (await readDiagnostics(page))?.commands.includes(commandId) ?? false, {
      timeout: 20_000,
    })
    .toBe(present);
}

/** True once the editor feature is merged (the `page` body is registered). */
export async function hasEditor(page: Page): Promise<boolean> {
  return (await readDiagnostics(page))?.contributions.pageBodies?.includes('page') ?? false;
}
