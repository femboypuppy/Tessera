import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { addView, choose, grid, header, openWorkspace } from './helpers';

/**
 * `pnpm screenshots e2e/databases` writes the databases screenshots used by the docs and README:
 * `table`, `board`, `calendar`, `gallery` and `filter-builder`, light and dark.
 */
const OUT = fileURLToPath(new URL('../../assets/screenshots/databases/', import.meta.url));

async function snap(page: Page, name: string, options: { blur?: boolean } = {}): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // No hover or focus-ring noise in the pictures (unless the picture is about a focused popover).
  await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  if (options.blur !== false) {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
  }
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

/** Scrolls the page and the table back to the top left. */
async function resetScroll(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('*')) {
      if (element.scrollTop > 0) element.scrollTop = 0;
      if (element.scrollLeft > 0) element.scrollLeft = 0;
    }
  });
}

/** Drags a column's resize edge to the given width. */
async function resizeColumn(page: Page, name: string, width: number): Promise<void> {
  const box = await header(page, name).boundingBox();
  if (!box) throw new Error(`no column ${name}`);
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width - 1, y);
  await page.mouse.down();
  await page.mouse.move(box.x + width - 1, y, { steps: 4 });
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await header(page, name).boundingBox())?.width ?? 0))
    .toBe(width);
}

/** A day of the current month as `YYYY-MM-DD` (the calendar opens on today's month). */
function day(n: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
}

function csv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(','),
    )
    .join('\n');
}

const ROADMAP = csv([
  ['Task', 'Status', 'Owner', 'Priority', 'Estimate', 'Due', 'Tags', 'Shipped'],
  // The first rows introduce the options in workflow order (options follow first appearance).
  ['Template gallery', 'Backlog', 'Priya Raman', 'High', '5', '', 'Onboarding', 'no'],
  [
    'Calendar sync with Google',
    'Planned',
    'Priya Raman',
    'Medium',
    '8',
    day(28),
    'Integrations',
    'no',
  ],
  ['Image uploads in comments', 'Backlog', 'Tomás Varga', 'Low', '3', '', 'Editor', 'no'],
  [
    'Offline mode for mobile',
    'In progress',
    'Priya Raman',
    'High',
    '8',
    `${day(14)} → ${day(18)}`,
    'Mobile, Sync',
    'no',
  ],
  [
    'Redesign the onboarding checklist',
    'In review',
    'Marcus Chen',
    'High',
    '5',
    day(24),
    'Onboarding, Design',
    'no',
  ],
  ['Keyboard shortcuts cheat sheet', 'Done', 'Ana Souza', 'Low', '2', day(3), 'Docs', 'yes'],
  [
    'Faster search indexing',
    'In progress',
    'Tomás Varga',
    'Medium',
    '5',
    day(25),
    'Performance, Search',
    'no',
  ],
  ['Dark mode polish', 'Done', 'Ana Souza', 'Medium', '3', day(9), 'Design', 'yes'],
  ['CSV export for reports', 'Done', 'Jonas Weber', 'Low', '2', day(2), 'Reports', 'yes'],
  [
    'Team permissions',
    'Planned',
    'Marcus Chen',
    'High',
    '13',
    `${day(21)} → ${day(27)}`,
    'Security',
    'no',
  ],
  ['Usage analytics dashboard', 'Backlog', 'Jonas Weber', 'Low', '8', '', 'Reports', 'no'],
  ['Two-factor authentication', 'In review', 'Tomás Varga', 'High', '5', day(22), 'Security', 'no'],
  ['Public API rate limits', 'Planned', 'Jonas Weber', 'Medium', '3', day(26), 'API', 'no'],
  ['Release notes for 2.4', 'Planned', 'Ana Souza', 'Low', '1', day(28), 'Docs', 'no'],
  [
    'Fix sync conflicts on flaky Wi-Fi',
    'In progress',
    'Priya Raman',
    'High',
    '3',
    day(23),
    'Sync, Bug',
    'no',
  ],
  ['Slack notifications', 'Backlog', 'Marcus Chen', 'Medium', '5', '', 'Integrations', 'no'],
  [
    'Accessibility audit',
    'In progress',
    'Ana Souza',
    'High',
    '5',
    `${day(8)} → ${day(12)}`,
    'Accessibility',
    'no',
  ],
  ['Customer interviews for Q4', 'Done', 'Marcus Chen', 'Medium', '2', day(16), 'Research', 'yes'],
  ['Migrate billing to Stripe', 'Planned', 'Jonas Weber', 'High', '8', day(19), 'Billing', 'no'],
  [
    'Performance budget in CI',
    'In review',
    'Tomás Varga',
    'Medium',
    '2',
    day(11),
    'Performance',
    'no',
  ],
]);

const BOOKS: ReadonlyArray<{
  title: string;
  author: string;
  status: string;
  genres: string;
  rating: string;
  colors: [string, string];
}> = [
  {
    title: 'Piranesi',
    author: 'Susanna Clarke',
    status: 'Finished',
    genres: 'Fantasy',
    rating: '5',
    colors: ['#1f4e5f', '#8fb9a8'],
  },
  {
    title: 'Project Hail Mary',
    author: 'Andy Weir',
    status: 'Finished',
    genres: 'Science fiction',
    rating: '5',
    colors: ['#f2a541', '#2d3047'],
  },
  {
    title: 'The Overstory',
    author: 'Richard Powers',
    status: 'Reading',
    genres: 'Literary, Nature',
    rating: '4',
    colors: ['#2e5930', '#c5d86d'],
  },
  {
    title: 'Klara and the Sun',
    author: 'Kazuo Ishiguro',
    status: 'Finished',
    genres: 'Literary',
    rating: '4',
    colors: ['#f7c548', '#e4572e'],
  },
  {
    title: 'Braiding Sweetgrass',
    author: 'Robin Wall Kimmerer',
    status: 'To read',
    genres: 'Nature, Nonfiction',
    rating: '',
    colors: ['#6a994e', '#f2e8cf'],
  },
  {
    title: 'The Dispossessed',
    author: 'Ursula K. Le Guin',
    status: 'Finished',
    genres: 'Science fiction, Classic',
    rating: '5',
    colors: ['#3d348b', '#f18701'],
  },
  {
    title: 'Circe',
    author: 'Madeline Miller',
    status: 'Reading',
    genres: 'Fantasy, Myth',
    rating: '',
    colors: ['#7b2d26', '#e9b44c'],
  },
  {
    title: 'Sapiens',
    author: 'Yuval Noah Harari',
    status: 'To read',
    genres: 'History, Nonfiction',
    rating: '',
    colors: ['#d9d9d9', '#b23a48'],
  },
];

/** Imports a CSV file from the sidebar and waits for the new database. */
async function importCsv(page: Page, name: string, text: string, rows: number): Promise<void> {
  await page.getByRole('button', { name: 'Import CSV as database' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import a CSV file' });
  await dialog.getByLabel('Choose a CSV file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(text),
  });
  await dialog.getByRole('button', { name: `Import ${rows} rows` }).click();
  await expect(page.getByText(`${rows} rows`, { exact: true })).toBeVisible({ timeout: 30_000 });
}

async function setPageIcon(page: Page, search: string): Promise<void> {
  await page.getByRole('textbox', { name: 'Page title' }).hover();
  await page.getByRole('button', { name: 'Add icon' }).click();
  await page.getByRole('searchbox', { name: 'Search emoji' }).fill(search);
  await expect(page.locator('button[data-emoji]').first()).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Change icon' })).toBeVisible();
}

/** Draws a book cover (title and author on a two-tone design) and returns it as a PNG. */
async function bookCover(page: Page, book: (typeof BOOKS)[number]): Promise<Buffer> {
  const dataUrl = await page.evaluate(({ title, author, colors }) => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 450;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.fillStyle = colors[0];
    g.fillRect(0, 0, 800, 450);
    g.fillStyle = colors[1];
    g.beginPath();
    g.arc(640, 90, 150, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 0.35;
    g.fillRect(0, 330, 800, 12);
    g.globalAlpha = 1;
    g.fillStyle = '#ffffff';
    g.font = '600 54px Georgia, serif';
    g.fillText(title, 48, 250, 700);
    g.font = '400 28px system-ui, sans-serif';
    g.fillText(author.toUpperCase(), 48, 300, 700);
    return canvas.toDataURL('image/png');
  }, book);
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
}

test('databases screenshots', async ({ page }) => {
  test.setTimeout(600_000);
  await openWorkspace(page, 'Northwind studio');

  // A project tracker ------------------------------------------------------------------------------
  await importCsv(page, 'Product roadmap.csv', ROADMAP, 20);
  await setPageIcon(page, 'rocket');
  for (const [column, type] of [
    ['Status', 'select'],
    ['Priority', 'select'],
    ['Estimate', 'number'],
    ['Due', 'date'],
    ['Tags', 'multiSelect'],
    ['Shipped', 'checkbox'],
  ] as const) {
    await expect(header(page, column)).toHaveAttribute('data-property-type', type);
  }

  // Sorted by due date, with the total estimate in the footer, sized to fit the page.
  await page.getByRole('button', { name: 'Close sidebar' }).click();
  await page.getByRole('button', { name: 'Sort', exact: true }).click();
  await page.getByRole('button', { name: 'Add a sort' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Property' }), 'Due');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Add a sort' })).toBeHidden();
  for (const [name, width] of [
    ['Task', 240],
    ['Status', 130],
    ['Owner', 135],
    ['Priority', 105],
    ['Estimate', 100],
    ['Due', 220],
    ['Tags', 170],
  ] as const) {
    await resizeColumn(page, name, width);
  }
  const estimateCol = await header(page, 'Estimate').getAttribute('aria-colindex');
  await grid(page).locator(`[id*="-footer-"][aria-colindex="${estimateCol}"] button`).click();
  await page.getByRole('menuitemradio', { name: 'Sum' }).click();
  await expect(grid(page).getByText('Sum', { exact: true })).toBeVisible();
  await resetScroll(page);
  await snap(page, 'table');

  // The filter builder: open work that is urgent or large.
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('button', { name: 'Add a filter rule' }).click();
  await choose(page, page.getByRole('combobox', { name: 'Property' }), 'Status');
  await choose(page, page.getByRole('combobox', { name: 'Condition' }), 'is not');
  // A single-value picker closes once a value is picked.
  await page.getByRole('button', { name: 'Value' }).click();
  await page.getByRole('option', { name: 'Done' }).click();
  await expect(page.getByRole('option', { name: 'Done' })).toBeHidden();
  await page.getByRole('button', { name: 'Add a filter group' }).click();
  const group = page.getByRole('group', { name: 'Filter group' });
  await choose(page, group.getByRole('combobox', { name: 'Property' }), 'Priority');
  await group.getByRole('button', { name: 'Value' }).click();
  await page.getByRole('option', { name: 'High' }).click();
  await expect(page.getByRole('option', { name: 'High' })).toBeHidden();
  await group.getByRole('button', { name: 'Add a filter rule' }).click();
  await choose(page, group.getByRole('combobox', { name: 'Property' }).nth(1), 'Estimate');
  await choose(page, group.getByRole('combobox', { name: 'Condition' }).nth(1), '≥');
  await group.getByRole('textbox', { name: 'Value' }).fill('8');
  await expect(page.getByText(/^\d+ of 20$/)).toBeVisible();
  await resetScroll(page);
  await snap(page, 'filter-builder', { blur: false });
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByText('20 rows', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Open sidebar' }).click();

  // The board, grouped by status, with owner, priority and due date on the cards.
  await addView(page, 'Board');
  await page.getByRole('button', { name: 'Properties' }).click();
  for (const name of ['Owner', 'Priority', 'Due']) {
    await page.getByRole('switch', { name }).click();
  }
  await page.keyboard.press('Escape');
  // Every task has a status: hide the empty "No Status" column.
  await page.getByRole('button', { name: 'More: No Status' }).click();
  await page.getByRole('menuitem', { name: 'Hide group' }).click();
  await expect(page.locator('section[data-group-key]').first()).toContainText('Backlog');
  await snap(page, 'board');

  // The calendar by due date.
  await addView(page, 'Calendar');
  await expect(page.getByRole('button', { name: /^Offline mode for mobile,/ })).toBeVisible();
  await snap(page, 'calendar');

  // A reading list gallery -------------------------------------------------------------------------
  await importCsv(
    page,
    'Reading list.csv',
    csv([
      ['Title', 'Author', 'Status', 'Genres', 'Rating'],
      ...BOOKS.map((book) => [book.title, book.author, book.status, book.genres, book.rating]),
    ]),
    BOOKS.length,
  );
  await setPageIcon(page, 'books');
  const readingList = page.url();
  for (const book of BOOKS) {
    const cover = await bookCover(page, book);
    const row = grid(page)
      .locator('[role="row"][data-row-id]')
      .filter({ hasText: new RegExp(`^${book.title}`) });
    await row.click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Open as page' }).click();
    await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue(book.title);
    await page.getByRole('textbox', { name: 'Page title' }).hover();
    await page.getByRole('button', { name: 'Add cover' }).click();
    await page.getByRole('button', { name: 'Change cover' }).hover();
    await page.getByRole('button', { name: 'Change cover' }).click();
    await page.getByRole('tab', { name: 'Upload image' }).click();
    await page.locator('input[type="file"][aria-label="Upload image"]').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: cover,
    });
    await expect(page.locator('article img').first()).toBeVisible();
    await page.keyboard.press('Escape');
    // Back to the database (in-app navigation: the workspace lives in memory).
    await page.goBack();
    await expect(page).toHaveURL(readingList);
    await expect(grid(page)).toBeVisible();
  }
  await addView(page, 'Gallery');
  await page.getByRole('button', { name: 'Properties' }).click();
  for (const name of ['Author', 'Status', 'Genres']) {
    await page.getByRole('switch', { name }).click();
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Piranesi', exact: true })).toBeVisible();
  await expect(page.locator('img[src^="blob:"]').first()).toBeVisible();
  await snap(page, 'gallery');
});
