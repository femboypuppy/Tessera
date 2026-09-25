import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { BOOKS } from './data';
import {
  addProperty,
  addRow,
  columnTexts,
  grid,
  header,
  newDatabase,
  openWorkspace,
  pasteIntoGrid,
  rowTitles,
} from './helpers';

// Long flows (many steps, drags); busy CI machines and Firefox need more than the default.
test.describe.configure({ timeout: 90_000 });

/** A small CSV reader for the checks (quoted fields, doubled quotes, CRLF). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

test('exports the current view to CSV, matching what the table shows', async ({ page }) => {
  await openWorkspace(page);
  await newDatabase(page, 'Reading list');
  await addProperty(page, 'Text', 'Author');
  await addProperty(page, 'Number', 'Pages');
  await addProperty(page, 'Select', 'Status');
  await addProperty(page, 'Date', 'Finished on');
  await addRow(page, 'Dune');
  await pasteIntoGrid(
    page,
    BOOKS.map((book) => [book.title, book.author, String(book.pages), book.status, book.finished]),
  );
  await expect(page.getByText('20 rows', { exact: true })).toBeVisible();

  // The view sorts by pages, most first, and hides nothing.
  await header(page, 'Pages').getByRole('button').click();
  await page.getByRole('menuitem', { name: 'Sort descending' }).click();
  await expect.poll(async () => (await rowTitles(page))[0]).toBe('Middlemarch');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'More database actions' }).click();
  await page.getByRole('menuitem', { name: 'Export view as CSV' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Reading list - Table.csv');
  const path = await file.path();
  const csv = parseCsv(await readFile(path, 'utf8'));

  const [head, ...rows] = csv;
  // The property columns' headers (the last header holds "Add a property").
  const headers = await grid(page)
    .getByRole('columnheader')
    .filter({ hasNot: page.getByRole('button', { name: 'Add a property' }) })
    .allInnerTexts();
  expect(head).toEqual(headers.map((text) => text.trim()));
  expect(rows).toHaveLength(20);

  // Same rows in the same order, with the same values (numbers and dates in plain form).
  const titles = await rowTitles(page);
  const shown = titles.length;
  expect(rows.slice(0, shown).map((row) => row[0])).toEqual(titles);
  const authors = await columnTexts(page, 'Author');
  const pages = await columnTexts(page, 'Pages');
  const statuses = await columnTexts(page, 'Status');
  expect(rows.slice(0, shown).map((row) => row[1])).toEqual(authors);
  expect(rows.slice(0, shown).map((row) => Number(row[2]))).toEqual(
    pages.map((text) => Number(text.replace(/,/g, ''))),
  );
  expect(rows.slice(0, shown).map((row) => row[3])).toEqual(statuses);
  const expected = [...BOOKS].sort((a, b) => b.pages - a.pages);
  expect(rows.map((row) => row[4])).toEqual(expected.map((book) => book.finished));
});

const IMPORT = [
  'Title,Author,Pages,Rating,Price,Status,Tags,Started,Finished,Link,Contact',
  'Dune,Frank Herbert,688,90%,$9.99,Finished,"Science fiction, Classic",2026-01-02,yes,https://example.org/dune,frank@example.org',
  'Piranesi,Susanna Clarke,272,85%,$14.50,Finished,Fantasy,2026-02-10,yes,https://example.org/piranesi,susanna@example.org',
  'Middlemarch,George Eliot,880,70%,$7.25,To read,"Classic, Literary",2026-03-01,no,https://example.org/middlemarch,george@example.org',
  'Circe,Madeline Miller,393,88%,$12.00,Reading,"Fantasy, Myth",2026-03-15,no,https://example.org/circe,madeline@example.org',
  'The Hobbit,J. R. R. Tolkien,310,95%,$8.99,Finished,"Fantasy, Classic",2026-04-01,yes,https://example.org/hobbit,tolkien@example.org',
  'Educated,Tara Westover,334,80%,$11.00,To read,Memoir,2026-05-20,no,https://example.org/educated,tara@example.org',
].join('\n');

test('imports a CSV file as a database with inferred types', async ({ page }) => {
  await openWorkspace(page);
  await page.getByRole('button', { name: 'Import CSV as database' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a CSV file' });
  await dialog.getByLabel('Choose a CSV file').setInputFiles({
    name: 'Books.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(IMPORT),
  });

  // The preview shows each column's guessed type.
  const guessed: Record<string, string> = {
    Author: 'Text',
    Pages: 'Number',
    Rating: 'Number',
    Price: 'Number',
    Status: 'Select',
    Tags: 'Multi-select',
    Started: 'Date',
    Finished: 'Checkbox',
    Link: 'URL',
    Contact: 'Email',
  };
  await expect(dialog.locator('tr[data-column="Title"] [data-type="title"]')).toBeVisible();
  for (const [column, type] of Object.entries(guessed)) {
    await expect(dialog.getByRole('combobox', { name: `Type: ${column}` })).toHaveText(type);
  }
  await expect(dialog.getByLabel('Database title')).toHaveValue('Books');
  await dialog.getByRole('button', { name: 'Import 6 rows' }).click();

  // The new database opens with typed columns and every row.
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Books');
  await expect(page.getByText('6 rows', { exact: true })).toBeVisible();
  const stored: Record<string, string> = {
    Title: 'title',
    Author: 'text',
    Pages: 'number',
    Rating: 'number',
    Price: 'number',
    Status: 'select',
    Tags: 'multiSelect',
    Started: 'date',
    Finished: 'checkbox',
    Link: 'url',
    Contact: 'email',
  };
  for (const [column, type] of Object.entries(stored)) {
    await expect(header(page, column)).toHaveAttribute('data-property-type', type);
  }
  expect(await rowTitles(page)).toEqual([
    'Dune',
    'Piranesi',
    'Middlemarch',
    'Circe',
    'The Hobbit',
    'Educated',
  ]);
  expect(await columnTexts(page, 'Rating')).toContain('90%');
  expect(await columnTexts(page, 'Price')).toContain('$9.99');
  expect(await columnTexts(page, 'Tags')).toContain('Science fictionClassic');
  expect(await columnTexts(page, 'Started')).toContain('Jan 2, 2026');
  expect((await columnTexts(page, 'Finished')).filter((text) => text === 'Checked')).toHaveLength(
    3,
  );
});
