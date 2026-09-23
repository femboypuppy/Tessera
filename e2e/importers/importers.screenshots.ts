import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { fixturePath, pageTree, researchVault, sidebar, writeZip } from './helpers';

/** `pnpm screenshots e2e/importers` writes the import and export screenshots used by the docs. */
const OUT = fileURLToPath(new URL('../../assets/screenshots/importers/', import.meta.url));

/** Captures the current view in the light and the dark theme (the app follows the system theme). */
async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // No hover or focus-ring noise in the pictures.
  await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

/** A workspace with the demo content in the background of every picture. */
async function openDemoWorkspace(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Open the demo workspace/ }).click();
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Start here');
  await expect(
    pageTree(page).getByRole('treeitem', { name: 'Projects', exact: true }),
  ).toBeVisible();
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

test('import and export screenshots', async ({ page }) => {
  await openDemoWorkspace(page);

  // The import dialog, after picking a vault: detected source, preview, root page name.
  await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import' });
  await dialog.getByTestId('import-folder-input').setInputFiles(fixturePath('obsidian-vault'));
  await expect(dialog.getByRole('button', { name: /^Import \d+ files$/ })).toBeVisible();
  await dialog.getByLabel('New page for the import').fill('Apollo vault');
  await blur(page);
  await snap(page, 'import-dialog');

  // The report of that import.
  await dialog.getByRole('button', { name: /^Import \d+ files$/ }).click();
  const report = page.getByRole('dialog', { name: 'Import complete' });
  await expect(report).toBeVisible({ timeout: 30_000 });
  await report.getByText('Links to pages that were not in the import').click();
  await blur(page);
  await snap(page, 'import-report');
  await report.getByRole('button', { name: 'Import more' }).click();

  // Progress, while a 1,500-note vault imports.
  const vault = writeZip(researchVault(1500));
  await page
    .getByRole('dialog', { name: 'Import' })
    .getByTestId('import-files-input')
    .setInputFiles({ name: 'Research vault.zip', mimeType: 'application/zip', buffer: vault });
  const start = page.getByRole('dialog', { name: 'Import' }).getByRole('button', {
    name: /^Import [\d,]+ files$/,
  });
  await start.click();
  const progress = page.getByRole('dialog', { name: 'Importing…' });
  await expect(progress.locator('[data-phase="pages"]')).toBeVisible({ timeout: 60_000 });
  await expect(progress.getByText(/^[\d,]+ of [\d,]+$/)).toBeVisible();
  await snap(page, 'import-progress');
  await expect(page.getByRole('dialog', { name: 'Import complete' })).toBeVisible({
    timeout: 120_000,
  });
  await page.keyboard.press('Escape');

  // The export dialog, opened from a page.
  await pageTree(page).getByRole('treeitem', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Export page' }).click();
  const exportDialog = page.getByRole('dialog', { name: 'Export' });
  await expect(exportDialog.getByRole('radio', { name: /^Markdown \(zip\)/ })).toBeChecked();
  await blur(page);
  await snap(page, 'export-dialog');
});
