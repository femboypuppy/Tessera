/**
 * `pnpm screenshots e2e/ci`: the seeded workspace (packages/testkit's generator in the real
 * shell), saved as assets/screenshots/ci/seeded-workspace-{light,dark}.png.
 */
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { expect, test } from '../support';

const OUT = fileURLToPath(new URL('../../assets/screenshots/ci/', import.meta.url));

async function snap(page: Page, name: string): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
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

test.use({ seedOptions: { seed: 42, pages: 300, databases: 3, rowsPerDatabase: 12 } });

test('seeded workspace', async ({ seededWorkspace: { app, state }, page }) => {
  // The top-level page with the biggest subtree, opened with its first two levels expanded.
  const childrenOf = (id: string) =>
    state.pages.filter((entry) => entry.parentId === id && entry.role !== 'row');
  const topLevel = state.pages.filter((entry) => entry.parentId === null && entry.role === 'page');
  const [root] = [...topLevel].sort((a, b) => childrenOf(b.id).length - childrenOf(a.id).length);
  if (!root) throw new Error('No top-level page');
  await app.openPage(root.title);
  await app.treeItem(root.title).focus();
  await page.keyboard.press('ArrowRight');
  const [child] = childrenOf(root.id).filter((entry) => childrenOf(entry.id).length > 0);
  if (child) {
    await app.treeItem(child.title).focus();
    await page.keyboard.press('ArrowRight');
    await expect(app.treeItem(childrenOf(child.id)[0]?.title ?? '')).toBeVisible();
  }
  await snap(page, 'seeded-workspace');
});
