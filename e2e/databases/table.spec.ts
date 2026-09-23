import { expect, test } from '@playwright/test';
import { BOOKS } from './data';
import {
  addProperty,
  addRow,
  choose,
  columnTexts,
  copyFromGrid,
  grid,
  header,
  newDatabase,
  openWorkspace,
  pasteIntoGrid,
  rowByTitle,
  rowTitles,
  selectFirstCell,
} from './helpers';

const PROPERTIES: ReadonlyArray<[type: string, name: string, stored: string]> = [
  ['Text', 'Author', 'text'],
  ['Number', 'Pages', 'number'],
  ['Select', 'Status', 'select'],
  ['Multi-select', 'Genres', 'multiSelect'],
  ['Date', 'Finished on', 'date'],
  ['Checkbox', 'Owned', 'checkbox'],
  ['URL', 'Link', 'url'],
  ['Email', 'Contact', 'email'],
  ['Relation', 'Related', 'relation'],
  ['Created time', 'Added', 'createdTime'],
  ['Last edited time', 'Edited', 'updatedTime'],
];

test('creates a database with every property type, 20 rows, a filter and a sort', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openWorkspace(page);
  await newDatabase(page, 'Reading list');
  await expect(
    page
      .getByRole('link', { name: 'Reading list' })
      .or(page.getByRole('treeitem', { name: 'Reading list' }))
      .first(),
  ).toBeVisible();

  // One property of every type.
  for (const [type, name] of PROPERTIES) await addProperty(page, type, name);
  for (const [, name, stored] of PROPERTIES) {
    await expect(header(page, name)).toHaveAttribute('data-property-type', stored);
  }
  await expect(header(page, 'Name')).toHaveAttribute('data-property-type', 'title');

  // Twenty rows: type the first, paste the rest like from a spreadsheet (which adds rows).
  await addRow(page, 'Dune');
  const block = BOOKS.map((book, index) => [
    book.title,
    book.author,
    String(book.pages),
    book.status,
    book.genres,
    book.finished,
    book.owned ? 'Yes' : 'No',
    book.link,
    book.contact,
    index === 1 ? 'Dune' : '',
  ]);
  await pasteIntoGrid(page, block);
  await expect(page.getByText('20 rows', { exact: true })).toBeVisible();
  await expect(rowByTitle(page, 'Children of Time')).toBeVisible();

  // Values rendered with the right display for their type.
  const dune = rowByTitle(page, 'Dune');
  await expect(dune).toContainText('Frank Herbert');
  await expect(dune).toContainText('688');
  await expect(dune).toContainText('Finished');
  await expect(dune).toContainText('Science fiction');
  await expect(dune).toContainText('Jan 14, 2026');
  await expect(dune.getByText('Checked')).toBeAttached();
  await expect(
    dune.getByRole('link', { name: 'https://en.wikipedia.org/wiki/Dune_(novel)' }),
  ).toBeAttached();
  await expect(
    rowByTitle(page, 'The Left Hand of Darkness').getByRole('link', { name: 'Dune' }),
  ).toBeAttached();

  // Copy a range back out: the clipboard holds the same text.
  await selectFirstCell(page);
  await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await copyFromGrid(page)).toBe(
    'Dune\tFrank Herbert\nThe Left Hand of Darkness\tUrsula K. Le Guin',
  );

  // Filter: Status is Reading.
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Add a filter rule' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Property' }), 'Status');
  await page.getByRole('button', { name: 'Value' }).click();
  await page.getByRole('option', { name: 'Reading' }).click();
  // Picking a single value closes the picker; then Escape closes the filter panel.
  await expect(page.getByRole('option', { name: 'Reading' })).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add a filter rule' })).toBeHidden();
  const reading = BOOKS.filter((book) => book.status === 'Reading');
  await expect(page.getByText(`${reading.length} of 20`)).toBeVisible();
  expect((await rowTitles(page)).sort()).toEqual(reading.map((book) => book.title).sort());
  await expect(page.getByRole('button', { name: /^Status is Reading/ })).toBeVisible();

  // Sort: Pages, descending, from the column menu.
  await header(page, 'Pages').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  const byPages = [...reading].sort((a, b) => b.pages - a.pages).map((book) => book.title);
  await expect.poll(() => rowTitles(page)).toEqual(byPages);
  expect(await columnTexts(page, 'Pages')).toEqual(
    [...reading]
      .sort((a, b) => b.pages - a.pages)
      .map((book) => book.pages.toLocaleString('en-US')),
  );

  // Clearing the filter brings every row back, still sorted.
  await page.getByRole('button', { name: 'Remove filter' }).click();
  await expect(page.getByText('20 rows', { exact: true })).toBeVisible();
  await expect.poll(async () => (await rowTitles(page))[0]).toBe('Middlemarch');
});

test('edits cells with the keyboard and deletes a row with undo', async ({ page }) => {
  await openWorkspace(page);
  await newDatabase(page, 'Tasks');
  await addProperty(page, 'Number', 'Estimate');
  await addProperty(page, 'Checkbox', 'Done');
  await addRow(page, 'Write the brief');

  // Mod+Enter adds a row and edits its title right away.
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.keyboard.type('Review the draft');
  await page.keyboard.press('Enter');
  await expect(rowByTitle(page, 'Review the draft')).toBeVisible();

  // Arrow to the number, type to replace, Enter saves; Space toggles the checkbox.
  await page.keyboard.press('ArrowRight');
  await page.keyboard.type('3');
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press(' ');
  const review = rowByTitle(page, 'Review the draft');
  await expect(review).toContainText('3');
  await expect(review.getByText('Checked')).toBeAttached();

  // Escape cancels an edit.
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('99');
  await page.keyboard.press('Escape');
  await expect(review).toContainText('3');
  await expect(review).not.toContainText('99');

  // Row actions: delete, then undo from the toast.
  await review.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(rowByTitle(page, 'Review the draft')).toBeVisible();
  await expect(grid(page)).toBeVisible();
});
