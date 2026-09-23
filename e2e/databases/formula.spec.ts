import { expect, test } from '@playwright/test';
import {
  addProperty,
  addRow,
  choose,
  columnTexts,
  header,
  newDatabase,
  openWorkspace,
  pasteIntoGrid,
  rowTitles,
} from './helpers';

test.describe.configure({ timeout: 90_000 });

test('adds a formula column and uses it like any other', async ({ page }) => {
  await openWorkspace(page);
  await newDatabase(page, 'Reading list');
  await addProperty(page, 'Number', 'Pages');
  await addRow(page, 'Dune');
  await pasteIntoGrid(page, [
    ['Dune', '688'],
    ['Piranesi', '272'],
    ['Circe', '393'],
  ]);
  await expect(page.getByText('3 rows', { exact: true })).toBeVisible();

  // A new formula opens in the formula editor.
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.getByRole('menuitem', { name: 'Formula', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Formula: Formula' });
  const input = dialog.getByRole('textbox', { name: 'Formula' });
  await expect(input).toBeVisible();

  // Mistakes are explained where they are, and can't be saved.
  await input.fill('prop("Pagez") / 30');
  await expect(dialog.getByRole('status')).toHaveText(
    'There is no property called “Pagez” (at character 1)',
  );
  await expect(dialog.getByRole('button', { name: 'Save formula' })).toBeDisabled();

  // Insert a property from the list, finish the formula, and see the preview.
  await input.fill('');
  await dialog.getByRole('button', { name: 'Insert round(number, digits)' }).click();
  await dialog.getByRole('button', { name: 'Insert Pages' }).click();
  await input.press('End');
  await input.pressSequentially(' / 30, 1)');
  await expect(input).toHaveValue('round(prop("Pages") / 30, 1)');
  await expect(dialog.getByText('22.9', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Save formula' }).click();
  await expect(dialog).toBeHidden();
  await expect.poll(() => columnTexts(page, 'Formula')).toEqual(['22.9', '9.1', '13.1']);

  // Sort by the formula.
  await header(page, 'Formula').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  await expect.poll(() => rowTitles(page)).toEqual(['Dune', 'Circe', 'Piranesi']);

  // Filter by it.
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Add a filter rule' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Property' }), 'Formula');
  await choose(page, page.getByRole('combobox', { name: 'Condition' }), '>');
  // The value applies as you type.
  await page.getByRole('textbox', { name: 'Value' }).fill('10');
  await expect(page.getByText('2 of 3')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add a filter rule' })).toBeHidden();

  // Renaming the property it reads keeps it working.
  await header(page, 'Pages').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Rename' }).click();
  const rename = page.getByRole('textbox', { name: 'Property name' });
  await rename.fill('Page count');
  await rename.press('Enter');
  await expect(header(page, 'Page count')).toBeVisible();
  await expect.poll(() => columnTexts(page, 'Formula')).toEqual(['22.9', '13.1']);

  // Enter on a formula cell opens its formula.
  await header(page, 'Formula').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Edit formula' }).click();
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Formula' })).toHaveValue(
    'round(prop("Page count") / 30, 1)',
  );
});
