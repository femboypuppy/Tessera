import { expect, test } from '@playwright/test';
import { createPage, createWorkspace, pageTree } from './helpers';

test('creates, renames, trashes and restores a page', async ({ page }) => {
  const sidebar = await createWorkspace(page, 'Apollo research');
  await expect(sidebar.getByText('Apollo research')).toBeVisible();

  await createPage(page, 'Launch plan');
  const tree = pageTree(page);
  await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText('Launch plan');

  // Rename through the title.
  const title = page.getByRole('textbox', { name: 'Page title' });
  await title.fill('Launch checklist');
  await expect(tree.getByRole('treeitem', { name: 'Launch checklist' })).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'Launch plan' })).toHaveCount(0);
  await expect(page).toHaveTitle('Launch checklist · Tessera');

  // Trash it from the page menu.
  await page.getByRole('button', { name: 'Page actions' }).click();
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(tree.getByRole('treeitem', { name: 'Launch checklist' })).toHaveCount(0);
  await expect(page.getByText('This page is in the trash.')).toBeVisible();
  await expect(title).toHaveAttribute('readonly', '');

  // Restore it from the Trash view.
  await sidebar.getByRole('button', { name: 'Trash' }).click();
  await expect(page.getByRole('heading', { name: 'Trash', level: 1 })).toBeVisible();
  const row = page.getByRole('listitem').filter({ hasText: 'Launch checklist' });
  await row.getByRole('button', { name: 'Restore' }).click();
  await expect(page.getByText('The trash is empty')).toBeVisible();
  await expect(tree.getByRole('treeitem', { name: 'Launch checklist' })).toBeVisible();

  // It opens again, editable.
  await tree.getByRole('treeitem', { name: 'Launch checklist' }).click();
  await expect(title).toHaveValue('Launch checklist');
  await expect(title).not.toHaveAttribute('readonly', '');
});

test('undoes a trash from the toast', async ({ page }) => {
  await createWorkspace(page, 'Reading');
  await createPage(page, 'Reading list');
  const tree = pageTree(page);

  await tree.getByRole('treeitem', { name: 'Reading list' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await expect(tree.getByRole('treeitem', { name: 'Reading list' })).toHaveCount(0);

  const notifications = page.getByRole('region', { name: /Notifications/ });
  await expect(notifications).toContainText('Moved “Reading list” to the trash');
  await notifications.getByRole('button', { name: 'Undo' }).click();
  await expect(tree.getByRole('treeitem', { name: 'Reading list' })).toBeVisible();
  await expect(page.getByText('This page is in the trash.')).toHaveCount(0);
});
