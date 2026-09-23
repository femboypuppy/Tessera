import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { openPalette, openWorkspace, palette, seed } from './helpers';

/** `pnpm screenshots e2e/search` writes the search, backlinks and graph screenshots. */
const OUT = fileURLToPath(new URL('../../assets/screenshots/search/', import.meta.url));

/** Captures the current view in the light and the dark theme. */
async function snap(page: Page, name: string, settle?: () => Promise<void>): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await settle?.();
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light' });
}

test('palette screenshot', async ({ page }) => {
  await openWorkspace(page, 'Field notes');
  await seed(page, 160, 11);
  // Open a page first (data lives in memory, so navigate inside the app).
  await openPalette(page);
  await page.keyboard.type('travel');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Travel');
  await openPalette(page);
  await page.keyboard.type('kyoto');
  const dialog = palette(page);
  await expect(dialog.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(dialog.getByText('Loading preview…')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await snap(page, 'palette', async () => {
    await expect(dialog.getByText('Loading preview…')).toHaveCount(0);
  });
});
