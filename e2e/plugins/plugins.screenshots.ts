import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createPage, createWorkspace, pageTree } from '../architect/helpers';
import {
  approvePrompt,
  ensureExamplesBuilt,
  hasEditor,
  installFromRegistry,
  openPluginSettings,
  pluginFrame,
  serveRegistry,
} from './support';

/** `pnpm screenshots e2e/plugins` writes the plugin screenshots used by the docs and README. */
const OUT = fileURLToPath(new URL('../../assets/screenshots/plugins/', import.meta.url));

/**
 * Captures the view in both themes. Plugin frames re-theme themselves after the app's theme
 * changes, so each capture waits a moment for them.
 */
async function snap(page: Page, name: string, settle = 600): Promise<void> {
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
    await page.waitForTimeout(settle);
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test.beforeAll(async () => {
  // The first run builds the example plugins (Mermaid takes a while).
  test.setTimeout(600_000);
  await ensureExamplesBuilt();
});

test('plugin screenshots', async ({ page }) => {
  await serveRegistry(page);
  await createWorkspace(page, 'Apollo research');
  for (const title of ['Apollo program', 'Mission control', 'Launch plan'])
    await createPage(page, title);

  await openPluginSettings(page);
  await page.getByRole('tab', { name: 'Browse' }).click();
  await expect(page.getByRole('heading', { name: 'Mermaid diagrams' })).toBeVisible();
  await snap(page, 'registry');

  await page.getByRole('button', { name: 'Install Daily notes' }).click();
  await expect(page.getByRole('dialog', { name: 'Install Daily notes?' })).toBeVisible();
  await snap(page, 'permission-prompt');
  await approvePrompt(page, 'Daily notes');

  for (const name of ['Word count', 'Pomodoro', 'Random page', 'Mermaid diagrams']) {
    await page.getByRole('button', { name: 'All plugins' }).click();
    await installFromRegistry(page, name);
  }
  await page.getByRole('button', { name: 'All plugins' }).click();
  await page.getByRole('tab', { name: /Installed/ }).click();
  await expect(page.getByText('Running', { exact: true })).toHaveCount(5, { timeout: 30_000 });
  await snap(page, 'plugin-settings');

  // Mermaid: in a page when the editor is there, otherwise in the plugin's block preview.
  if (await hasEditor(page)) {
    await pageTree(page).getByRole('treeitem', { name: 'Launch plan' }).click();
    await page.getByRole('textbox', { name: 'Page title' }).press('Enter');
    await page.keyboard.type('/mermaid');
    await page.keyboard.press('Enter');
  } else {
    await page.getByRole('button', { name: 'Details for Mermaid diagrams' }).click();
    await page.getByRole('button', { name: 'Preview' }).click();
  }
  const diagram = pluginFrame(page, 'Mermaid diagram (Mermaid diagrams)');
  await expect(diagram.getByText('Capture an idea')).toBeVisible({ timeout: 30_000 });
  await snap(page, 'mermaid-block', 1_500);

  await pageTree(page).getByRole('treeitem', { name: 'Apollo program' }).click();
  await page.getByRole('button', { name: 'Pomodoro', exact: true }).click();
  const timer = pluginFrame(page, 'Pomodoro panel');
  await timer.getByRole('button', { name: 'Start' }).click();
  await expect(timer.getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.waitForTimeout(3_000);
  await snap(page, 'pomodoro');
});
