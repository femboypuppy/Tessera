/**
 * Journey 4: a database. Create one from the sidebar, add rows and a select property, show it as a
 * board, and open a row as a page.
 */
import { expect, test } from '../support';

test('build a reading list database with a board view', async ({ freshWorkspace: app, page }) => {
  await app.expectFeatures('databases');
  const main = page.getByRole('main');

  await test.step('the sidebar creates a database page', async () => {
    await app
      .sidebar()
      .getByRole('button', { name: /new database/i })
      .click();
    await expect(app.titleField()).toBeFocused();
    await page.keyboard.type('Reading list');
    await expect(app.treeItem('Reading list')).toBeVisible();
  });

  await test.step('rows are added from the table', async () => {
    // The grid's own "New" row edits the title in place (the toolbar's "New" opens a side peek).
    const grid = main.getByRole('grid').first();
    for (const title of ['Carrying the Fire', 'Packing for Mars', 'The Right Stuff']) {
      await grid.getByRole('button', { name: 'New', exact: true }).click();
      await expect(page.getByRole('textbox', { name: /^Edit / })).toBeFocused();
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      await expect(main.getByText(title, { exact: true })).toBeVisible();
    }
  });

  await test.step('a select property groups the rows', async () => {
    // "Add a property" asks for the type first, then for the name.
    await main.getByRole('button', { name: /add a property/i }).click();
    await page.getByRole('menuitem', { name: 'Select', exact: true }).click();
    const name = page.getByRole('textbox', { name: /property name/i });
    await expect(name).toBeFocused();
    await name.fill('Status');
    await name.press('Enter');
    await expect(main.getByRole('columnheader', { name: /status/i })).toBeVisible();
  });

  await test.step('a board view shows the rows as cards', async () => {
    await main.getByRole('button', { name: /add a view/i }).click();
    await page
      .getByRole('menuitem', { name: /board/i })
      .or(page.getByRole('option', { name: /board/i }))
      .first()
      .click();
    await expect(main.getByRole('tab', { name: /board/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(main.getByText('Packing for Mars')).toBeVisible();
  });

  await test.step('a row opens as a page', async () => {
    // A card opens in the side peek first; from there it opens as a full page.
    await main.getByText('The Right Stuff', { exact: true }).first().click();
    await page.getByRole('button', { name: 'Open as page', exact: true }).click();
    await expect(app.titleField()).toHaveValue('The Right Stuff');
    await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText(
      'Reading list',
    );
  });
});
