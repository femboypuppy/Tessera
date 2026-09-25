import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { startSyncServer, TesseraApp } from '../support';
import { connectAndUpload, createInviteLink, joinWithInvite } from '../support/journeys';
import { fixturePath } from '../importers/helpers';
import {
  ensureExamplesBuilt,
  installFromRegistry,
  openPluginSettings,
  pluginFrame,
  serveRegistry,
} from '../plugins/support';

/**
 * The README's feature pictures, all from the demo workspace (agents/12-polish.md §5), in both
 * themes at 1440×900: `pnpm screenshots e2e/polish` writes
 * `assets/screenshots/showcase/<name>-{light,dark}.png`.
 */
const OUT = fileURLToPath(new URL('../../assets/screenshots/showcase/', import.meta.url));

async function snap(page: Page, name: string, settle = 0): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // Toasts left over from earlier steps would cover part of the view.
  const dismiss = page.getByRole('button', { name: 'Dismiss', exact: true });
  await expect(async () => {
    if ((await dismiss.count()) > 0) await dismiss.first().click({ timeout: 1_000 });
    expect(await dismiss.count()).toBe(0);
  }).toPass({ timeout: 15_000 });
  await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    if (settle) await page.waitForTimeout(settle);
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const tree = (page: Page) => sidebar(page).getByRole('tree', { name: 'Pages' });
const title = (page: Page) => page.getByRole('textbox', { name: 'Page title' });

async function openDemo(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Open the demo workspace/ }).click();
  await expect(title(page)).toHaveValue('Welcome to Tessera', { timeout: 60_000 });
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function openPage(page: Page, name: string, parent?: string): Promise<void> {
  if (parent) {
    const row = tree(page).getByRole('treeitem', { name: parent, exact: true });
    if ((await row.getAttribute('aria-expanded')) === 'false') {
      await row.focus();
      await page.keyboard.press('ArrowRight');
    }
  }
  await tree(page).getByRole('treeitem', { name, exact: true }).click();
  await expect(title(page)).toHaveValue(name);
}

test('write, databases, links, search and import', async ({ page }) => {
  test.setTimeout(240_000);
  await openDemo(page);

  // Write in blocks: a note with a table, a callout and a list.
  await openPage(page, 'Apollo 11', 'Knowledge garden');
  await expect(page.getByRole('main').locator('table')).toBeVisible();
  await blur(page);
  await snap(page, 'write');

  // Databases: the project board.
  await openPage(page, 'Projects');
  await expect(page.locator('section[data-group-key]').first()).toBeVisible();
  await blur(page);
  await snap(page, 'board');

  // Links and a graph: the knowledge garden, colored by tag.
  await sidebar(page).getByRole('button', { name: 'Graph view' }).click();
  await expect(page.getByRole('img', { name: /Graph view: \d+ pages/ })).toBeVisible({
    timeout: 30_000,
  });
  await page.waitForTimeout(6_000);
  await snap(page, 'graph');

  // Find anything: the palette with results and a preview.
  await openPage(page, 'Welcome to Tessera');
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('apollo');
  const palette = page.getByRole('dialog', { name: /command palette/i });
  await expect(palette.getByRole('option').first()).toBeVisible();
  await expect(palette.getByText('In pages')).toBeVisible();
  await page.waitForTimeout(500);
  await snap(page, 'palette');
  await page.keyboard.press('Escape');

  // Move in: the report of an Obsidian vault imported next to the demo.
  const vault = join(mkdtempSync(join(tmpdir(), 'tessera-showcase-')), 'Apollo vault');
  cpSync(fixturePath('obsidian-vault'), vault, { recursive: true });
  try {
    await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import' });
    await dialog.getByTestId('import-folder-input').setInputFiles(vault);
    await dialog.getByRole('button', { name: /^Import \d+ files$/ }).click();
    const report = page.getByRole('dialog', { name: 'Import complete' });
    await expect(report).toBeVisible({ timeout: 60_000 });
    await blur(page);
    await snap(page, 'import');
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test('plugins: a Mermaid diagram in a demo page', async ({ page }) => {
  test.setTimeout(600_000);
  await ensureExamplesBuilt();
  await serveRegistry(page);
  await openDemo(page);
  await openPluginSettings(page);
  await page.getByRole('tab', { name: 'Browse' }).click();
  await installFromRegistry(page, 'Mermaid diagrams');
  await openPage(page, 'Every block type');
  await sidebar(page).getByRole('button', { name: 'New page', exact: true }).first().click();
  await expect(title(page)).toBeFocused();
  await page.keyboard.type('Visitor flow');
  await page.keyboard.press('Enter');
  await page.keyboard.type('How visitors move through the six zones of the exhibit.');
  await page.keyboard.press('Enter');
  await page.keyboard.type('/mermaid');
  await page.keyboard.press('Enter');
  const diagram = pluginFrame(page, 'Mermaid diagram (Mermaid diagrams)');
  await expect(diagram.getByText('Capture an idea')).toBeVisible({ timeout: 30_000 });
  await blur(page);
  await snap(page, 'plugins', 1_500);
});

test('collaboration: two people in the welcome page', async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const server = await startSyncServer({ corsOrigins: [new URL(baseURL ?? '').origin] });
  const contexts = await Promise.all([
    browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } }),
    browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } }),
  ]);
  try {
    const [first, second] = await Promise.all(contexts.map((context) => context.newPage()));
    if (!first || !second) throw new Error('Could not open two pages');
    const maya = { email: 'maya@orbitlab.example', name: 'Maya', password: 'exhibit designer' };
    const theo = { email: 'theo@orbitlab.example', name: 'Theo', password: 'orbit simulator' };
    await openDemo(first);
    await server.createOwner(maya);
    const owner = new TesseraApp(first);
    await connectAndUpload(owner, server.url, maya);
    const invite = await createInviteLink(owner);
    await joinWithInvite(new TesseraApp(second), server.url, invite, theo, 'Tessera demo');
    await openPage(first, 'Inbox');
    await openPage(second, 'Inbox');
    // Theo adds to the list while Maya reads: his caret shows, labeled with his name.
    await second
      .getByRole('textbox', { name: 'Page content' })
      .locator('p', { hasText: 'for the intro panel' })
      .click();
    await second.keyboard.press('End');
    await second.keyboard.press('Enter');
    await second.keyboard.type('Borrow the Mercury capsule replica from the science museum');
    await expect(first.locator('.tess-remote-label')).toHaveText('Theo', { timeout: 20_000 });
    await expect(first.getByTestId('presence')).toHaveAccessibleName(/Theo/);
    await blur(first);
    await snap(first, 'collaboration');
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await server.stop();
  }
});
