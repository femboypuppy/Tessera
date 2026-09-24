/**
 * axe-core checks on the main screens, in both themes. Any serious or critical violation (WCAG
 * 2.2 A/AA and axe best practices) fails the test with a list of the offending elements, except
 * the known ones in accessibility-baseline.ts (code owned elsewhere, fixes proposed in
 * HANDOFF/ci.md), which are reported as annotations. Feature screens are checked once their
 * feature is registered.
 */
import type { Page } from '@playwright/test';
import { expect, formatViolations, scanAccessibility, test, type TesseraApp } from '../support';
import { partitionViolations } from './accessibility-baseline';

async function expectAccessible(page: Page): Promise<void> {
  const { fresh, known } = partitionViolations(await scanAccessibility(page));
  if (known.length) {
    test.info().annotations.push({
      type: 'known accessibility issues',
      description: formatViolations(known),
    });
  }
  expect(fresh, formatViolations(fresh)).toEqual([]);
}

/** A workspace with a few nested pages, an icon and a favorite. */
async function furnish(app: TesseraApp): Promise<void> {
  await app.newPage('Apollo program');
  await app.newPage('Mission control');
  await app.newPage('Reading list');
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test('onboarding', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByRole('button', { name: 'Create an empty workspace' })).toBeVisible();
      await expectAccessible(page);
    });

    test('empty workspace', async ({ freshWorkspace: app, page }) => {
      await expect(app.sidebar()).toBeVisible();
      await expectAccessible(page);
    });

    test('page view with a sidebar tree', async ({ freshWorkspace: app, page }) => {
      await furnish(app);
      await app.openPage('Mission control');
      await expectAccessible(page);
    });

    test('keyboard shortcuts overlay', async ({ freshWorkspace: app, page }) => {
      await furnish(app);
      await page.locator('body').click({ position: { x: 900, y: 600 } });
      await page.keyboard.press('Shift+?');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page);
    });

    test('trash', async ({ freshWorkspace: app, page }) => {
      await furnish(app);
      await app.sidebar().getByRole('button', { name: 'Trash' }).click();
      await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
      await expectAccessible(page);
    });

    test('settings', async ({ freshWorkspace: app, page }) => {
      await app.sidebar().getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectAccessible(page);
    });

    test('component gallery', async ({ page }) => {
      await page.goto('/dev/ui');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await expectAccessible(page);
    });

    test('command palette', async ({ freshWorkspace: app, page }) => {
      await app.expectFeatures('search');
      await furnish(app);
      await app.shortcut('Mod+K');
      await expect(page.getByRole('dialog')).toBeVisible();
      await expectAccessible(page);
    });

    test('graph view', async ({ freshWorkspace: app, page }) => {
      await app.expectFeatures('graph');
      await furnish(app);
      await page.goto('/graph');
      await expect(page.locator('main')).toBeVisible();
      await expectAccessible(page);
    });
  });
}

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('page view and the sidebar drawer', async ({ freshWorkspace: app, page }) => {
    await expectAccessible(page);
    await page.getByRole('button', { name: /open sidebar/i }).click();
    await expect(app.sidebar()).toBeVisible();
    await expectAccessible(page);
  });
});
