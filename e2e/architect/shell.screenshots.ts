import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { createPage, createWorkspace, pageTree } from './helpers';

/** `pnpm screenshots e2e/architect` writes the shell screenshots used by the docs and README. */
const OUT = fileURLToPath(new URL('../../assets/screenshots/architect/', import.meta.url));

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

async function setIcon(page: Page, pageTitle: string, search: string): Promise<void> {
  await pageTree(page).getByRole('treeitem', { name: pageTitle, exact: true }).click();
  await page.getByRole('textbox', { name: 'Page title' }).hover();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill(search);
  // The emoji data loads lazily: Enter picks the first result once there is one.
  await expect(page.locator('button[data-emoji]').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Change icon' })).toBeVisible();
}

async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

test('shell screenshots', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create an empty workspace' })).toBeVisible();
  await page.getByLabel('Workspace name').fill('Apollo research');
  await blur(page);
  await snap(page, 'onboarding');

  await createWorkspace(page, 'Apollo research');
  for (const title of [
    'Apollo program',
    'Mission control',
    'Lunar module checklist',
    'Reading list',
    'Launch plan',
    'Team handbook',
  ]) {
    await createPage(page, title);
  }
  const tree = pageTree(page);
  for (const child of ['Mission control', 'Lunar module checklist']) {
    await tree.getByRole('treeitem', { name: child, exact: true }).focus();
    await page.keyboard.press('Alt+Shift+ArrowRight');
  }
  await expect(tree.getByRole('treeitem', { name: 'Lunar module checklist' })).toHaveAttribute(
    'aria-level',
    '2',
  );

  await setIcon(page, 'Reading list', 'books');
  await setIcon(page, 'Team handbook', 'compass');
  await setIcon(page, 'Launch plan', 'calendar');
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await setIcon(page, 'Apollo program', 'rocket');
  await page.getByRole('textbox', { name: 'Page title' }).hover();
  await page.getByRole('button', { name: 'Add cover' }).click();
  // "Add cover" picks a random preset; the pictures use a fixed one.
  await page.getByRole('button', { name: 'Change cover' }).hover();
  await page.getByRole('button', { name: 'Change cover' }).click();
  await page.getByRole('button', { name: 'aurora', exact: true }).click();
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await blur(page);
  await snap(page, 'shell');

  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await blur(page);
  await snap(page, 'shortcuts');
  await page.keyboard.press('Escape');

  await tree.getByRole('treeitem', { name: 'Launch plan' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await tree.getByRole('treeitem', { name: 'Reading list' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  const notifications = page.getByRole('region', { name: /Notifications/ });
  for (const dismiss of await notifications.getByRole('button', { name: 'Dismiss' }).all())
    await dismiss.click();
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Trash' })
    .click();
  await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
  await blur(page);
  await snap(page, 'trash');

  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'Settings' })
    .click();
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await blur(page);
  await snap(page, 'settings');

  // Phone width: the page, then the sidebar drawer.
  await tree.getByRole('treeitem', { name: 'Apollo program' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeVisible();
  await blur(page);
  await snap(page, 'phone');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
  await blur(page);
  await snap(page, 'phone-sidebar');
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.goto('/dev/ui');
  await expect(page.getByRole('heading', { name: '@tessera/ui' })).toBeVisible();
  await snap(page, 'dev-ui');
});
