/**
 * Journey 1: a new user's first minutes with the shell. Onboarding, pages from the sidebar and
 * the keyboard, nesting, renaming, favorites, trash with undo, and the dark theme. Needs no
 * feature, so it runs on every build.
 */
import { expect, test } from '../support';

test('onboarding, pages, nesting, favorites, trash and themes', async ({ app, page }) => {
  await test.step('onboarding creates a workspace', async () => {
    await app.createWorkspace('Apollo research');
    await expect(app.sidebar().getByText('Apollo research')).toBeVisible();
  });

  await test.step('pages come from the sidebar and the keyboard', async () => {
    await app.newPage('Apollo program');
    await app.newPage('Mission control');
    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(app.titleField()).toBeFocused();
    await page.keyboard.type('Lunar module checklist');
    await expect(app.treeItem('Lunar module checklist')).toBeVisible();
    await expect(app.pageTree().getByRole('treeitem', { level: 1 })).toHaveCount(3);
  });

  await test.step('pages nest under the previous sibling from the keyboard', async () => {
    await app.treeItem('Mission control').focus();
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect(app.treeItem('Mission control')).toHaveAttribute('aria-level', '2');
    await app.treeItem('Lunar module checklist').focus();
    await page.keyboard.press('Alt+Shift+ArrowRight');
    await expect(app.treeItem('Lunar module checklist')).toHaveAttribute('aria-level', '2');
    await expect(app.pageTree().getByRole('treeitem', { level: 1 })).toHaveCount(1);
  });

  await test.step('the title renames a page everywhere', async () => {
    await app.openPage('Lunar module checklist');
    await app.titleField().fill('Lunar module preflight');
    await expect(app.treeItem('Lunar module preflight')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText(
      'Lunar module preflight',
    );
    await expect(page).toHaveTitle('Lunar module preflight · Tessera');
  });

  await test.step('favorites pin a page to the top of the sidebar', async () => {
    await page.getByRole('button', { name: 'Add to favorites' }).click();
    await expect(app.sidebar().getByRole('region').filter({ hasText: 'Favorites' })).toContainText(
      'Lunar module preflight',
    );
  });

  await test.step('trashing can be undone from the toast', async () => {
    await app.treeItem('Apollo program').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Move to trash' }).click();
    await expect(app.treeItem('Apollo program')).toHaveCount(0);
    const notifications = page.getByRole('region', { name: /Notifications/ });
    await notifications.getByRole('button', { name: 'Undo' }).click();
    await expect(app.treeItem('Apollo program')).toBeVisible();
    await expect(app.treeItem('Mission control')).toHaveAttribute('aria-level', '2');
  });

  await test.step('the theme switches to dark and back', async () => {
    await page.keyboard.press('ControlOrMeta+Shift+L');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.keyboard.press('ControlOrMeta+Shift+L');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });
});
