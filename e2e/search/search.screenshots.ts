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

async function waitForSettledGraph(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const graph = (window as unknown as { __tesseraGraph?: { settled(): boolean } })
        .__tesseraGraph;
      return graph?.settled() === true;
    },
    undefined,
    { timeout: 60_000 },
  );
  // Let sigma draw the final frame.
  await page.waitForTimeout(400);
}

test('graph screenshots', async ({ page }) => {
  await openWorkspace(page, 'Field notes');
  await seed(page, 300, 11);
  await openPalette(page);
  await page.keyboard.type('>graph view');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: /Graph view/ })).toBeVisible();
  await waitForSettledGraph(page);
  await page.mouse.move(0, 0);
  await snap(page, 'graph', () => page.waitForTimeout(300));
});

test('backlinks and local graph screenshots', async ({ page }) => {
  await openWorkspace(page, 'Field notes');
  await seed(page, 300, 11);
  await openPalette(page);
  await page.keyboard.type('europa');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Europa');

  await page.getByRole('button', { name: 'Backlinks', exact: true }).click();
  const backlinks = page.getByRole('complementary', { name: 'Backlinks' });
  await expect(backlinks.getByRole('region', { name: /Linked references/ })).toBeVisible();
  await expect(backlinks.getByText('Loading backlinks…')).toHaveCount(0);
  const mentionsHeader = backlinks.getByRole('button', { name: /^Unlinked mentions/ });
  await expect(backlinks.getByRole('button', { name: /Link this mention/ }).first()).toBeAttached();
  // Show both sections: the end of the references and the first mentions with Link buttons.
  await mentionsHeader.evaluate((element) => {
    // Scroll the panel only (scrollIntoView would also scroll the page).
    let scroller = element.parentElement;
    while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const offset = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop += offset - scroller.clientHeight * 0.4;
  });
  await page.mouse.move(0, 0);
  await snap(page, 'backlinks');

  await page.getByRole('button', { name: 'Local graph', exact: true }).first().click();
  await expect(page.getByRole('img', { name: /Local graph/ })).toBeVisible();
  await page.getByLabel('Depth 1').fill('2');
  await expect(page.getByText('Depth 2')).toBeVisible();
  await waitForSettledGraph(page);
  await page.mouse.move(0, 0);
  await snap(page, 'local-graph', () => page.waitForTimeout(300));
});
