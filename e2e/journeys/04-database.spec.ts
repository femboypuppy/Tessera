/**
 * Journey 4: a database. Create one from the sidebar, add rows and a select property, show it as a
 * board, and open a row as a page.
 */
import { expect, test } from '../support';

test('build a reading list database with a board view', async ({ freshWorkspace: app, page }) => {
  await app.requireFeatures('databases');
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
    for (const title of ['Carrying the Fire', 'Packing for Mars', 'The Right Stuff']) {
      await main.getByRole('button', { name: /^new$/i }).first().click();
      await page.keyboard.type(title);
      await page.keyboard.press('Enter');
      await expect(main.getByText(title, { exact: true })).toBeVisible();
    }
  });

  await test.step('a select property groups the rows', async () => {
    await main.getByRole('button', { name: /add a property/i }).click();
    await page.getByRole('textbox', { name: /property name/i }).fill('Status');
    await page
      .getByRole('option', { name: /^select$/i })
      .or(page.getByRole('menuitem', { name: /^select$/i }))
      .first()
      .click();
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
    await main.getByText('The Right Stuff', { exact: true }).first().click();
    await expect(app.titleField()).toHaveValue('The Right Stuff');
    await expect(page.getByRole('navigation', { name: 'Breadcrumbs' })).toContainText(
      'Reading list',
    );
  });
});
