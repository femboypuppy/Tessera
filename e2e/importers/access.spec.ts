import { expect, test } from '@playwright/test';
import { fixturePath } from './helpers';

test.describe('at phone width, from the keyboard', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('"Import from Obsidian" opens the dialog in a new workspace; it fits and works by keyboard', async ({
    page,
  }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Import from Obsidian/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Import' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('radio', { name: 'Obsidian' })).toBeChecked();

    // Nothing sticks out sideways.
    const box = await dialog.boundingBox();
    expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);

    // Focus is trapped in the dialog and reaches the file buttons by Tab.
    await expect
      .poll(() => dialog.evaluate((node) => node.contains(document.activeElement)))
      .toBe(true);
    const chooseFolder = dialog.getByRole('button', { name: 'Choose folder' });
    for (
      let step = 0;
      step < 12 && !(await chooseFolder.evaluate((node) => node === document.activeElement));
      step += 1
    )
      await page.keyboard.press('Tab');
    await expect(chooseFolder).toBeFocused();

    await dialog.getByTestId('import-folder-input').setInputFiles(fixturePath('obsidian-vault'));
    const start = dialog.getByRole('button', { name: /^Import \d+ files$/ });
    await expect(start).toBeVisible();
    await dialog.getByLabel('New page for the import').focus();
    // Enter in the page name starts the import.
    await page.keyboard.press('Enter');
    const report = page.getByRole('dialog', { name: 'Import complete' });
    await expect(report).toBeVisible({ timeout: 30_000 });
    const reportBox = await report.boundingBox();
    expect((reportBox?.x ?? 0) + (reportBox?.width ?? 0)).toBeLessThanOrEqual(390);
    await page.keyboard.press('Escape');
    await expect(report).toBeHidden();
  });
});
