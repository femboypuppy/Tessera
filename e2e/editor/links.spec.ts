import { expect, test } from '@playwright/test';
import {
  createPage,
  createWorkspace,
  docJSON,
  editor,
  findNodes,
  openPage,
  outline,
  pageTree,
  pasteData,
  redo,
  titleField,
  undo,
} from './helpers';

test('creates a page through [[, navigates to it and follows renames', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Mission control');
  await page.keyboard.type('Houston, we have a program. The crew checks in every hour.');
  await createPage(page, 'Launch plan');

  // Link an existing page.
  await page.keyboard.type('Read [[missi');
  const menu = page.getByRole('listbox', { name: 'Link to a page' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toContainText('Mission control');
  await page.keyboard.press('Enter');
  const missionLink = editor(page).locator('.tess-page-link', { hasText: 'Mission control' });
  await expect(missionLink).toBeVisible();

  // Create a page from the autocomplete.
  await page.keyboard.type('and [[Flight dynamics');
  await expect(menu.getByRole('option').last()).toContainText('Create page “Flight dynamics”');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  const flightLink = editor(page).locator('.tess-page-link', { hasText: 'Flight dynamics' });
  await expect(flightLink).toBeVisible();
  const doc = await docJSON(page);
  expect(findNodes(doc, 'pageLink')).toHaveLength(2);

  // The new page is a subpage of this one.
  await pageTree(page).getByRole('treeitem', { name: 'Launch plan' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(pageTree(page).getByRole('treeitem', { name: 'Flight dynamics' })).toBeVisible();

  // Hovering shows a preview with the first lines of the target.
  await missionLink.hover();
  const preview = page.getByRole('tooltip');
  await expect(preview).toContainText('Mission control');
  await expect(preview).toContainText('Houston, we have a program.');
  await page.mouse.move(0, 0);
  await expect(preview).toBeHidden();

  // Clicking navigates.
  await flightLink.click();
  await expect(titleField(page)).toHaveValue('Flight dynamics');

  // Renaming the target updates the link text live.
  await titleField(page).fill('Flight dynamics officer');
  await openPage(page, 'Launch plan');
  await expect(
    editor(page).locator('.tess-page-link', { hasText: 'Flight dynamics officer' }),
  ).toBeVisible();

  // A trashed target shows as broken.
  await pageTree(page)
    .getByRole('treeitem', { name: 'Mission control' })
    .click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Move to trash' }).click();
  await openPage(page, 'Launch plan');
  await expect(editor(page).locator('.tess-page-link[data-broken="trashed"]')).toBeVisible();

  // Undo removes the last link, redo brings it back.
  await editor(page).click();
  await page.keyboard.press('ControlOrMeta+End');
  const withLinks = await outline(page);
  await undo(page);
  await expect.poll(async () => findNodes(await docJSON(page), 'pageLink').length).toBeLessThan(2);
  await redo(page);
  await expect.poll(() => outline(page)).toEqual(withLinks);
});

test('@ mentions link pages, and #tags become tags', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Apollo');
  await createPage(page, 'Notes');
  await page.keyboard.type('Ask @apo');
  await page.keyboard.press('Enter');
  await page.keyboard.type('about #space/history today');
  const doc = await docJSON(page);
  expect(findNodes(doc, 'pageLink')).toHaveLength(1);
  expect(findNodes(doc, 'tag')[0]?.attrs?.name).toBe('space/history');
  await expect(editor(page).locator('.tess-tag')).toHaveText('#space/history');
  await expect(editor(page).locator('.tess-page-link')).toHaveText('Apollo');
});

test('pasting a URL over text links it; a bare URL offers an embed', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Links');
  await page.keyboard.type('Read the docs');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await page.keyboard.press('Shift+ArrowLeft');
  await pasteData(page, { 'text/plain': 'https://tessera.dev/docs' });
  await expect(editor(page).locator('a.tess-link')).toHaveText('docs');
  await expect(editor(page).locator('a.tess-link')).toHaveAttribute(
    'href',
    'https://tessera.dev/docs',
  );

  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await pasteData(page, { 'text/plain': 'https://vimeo.com/76979871' });
  const choices = page.getByRole('listbox', { name: 'Paste link as' });
  await expect(choices.getByRole('option')).toHaveText(['Link', 'Embed', 'Bookmark']);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(editor(page).locator('iframe[title="Vimeo embed"]')).toBeAttached();
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Read the docs', 'embed:', 'paragraph:']);
});
