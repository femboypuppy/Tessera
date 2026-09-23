import { expect, test, type Page } from '@playwright/test';
import {
  addProperty,
  addRow,
  addView,
  columnTexts,
  dragTo,
  newDatabase,
  openWorkspace,
  pasteIntoGrid,
  rowByTitle,
} from './helpers';

// Long flows (many steps, drags); busy CI machines and Firefox need more than the default.
test.describe.configure({ timeout: 90_000 });

const TASKS: ReadonlyArray<[title: string, stage: string]> = [
  ['Kickoff meeting', 'Planned'],
  ['Write the brief', 'Planned'],
  ['Design review', 'Doing'],
  ['Ship the beta', 'Done'],
];

/** A day of the current month as `YYYY-MM-DD` (the calendar opens on today's month). */
function dayThisMonth(day: number): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The day of the month of this month's first Monday (weeks start on Monday by default). */
function firstMonday(): number {
  const now = new Date();
  const weekday = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  return 1 + ((8 - weekday) % 7);
}

function fullDate(key: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeZone: 'UTC' }).format(
    Date.parse(`${key}T00:00:00Z`),
  );
}

async function stageOf(page: Page, title: string): Promise<string | undefined> {
  const titles = await columnTexts(page, 'Name');
  const stages = await columnTexts(page, 'Stage');
  return stages[titles.indexOf(title)];
}

test('drags a card to another board column, which changes its value', async ({ page }) => {
  await openWorkspace(page);
  await newDatabase(page, 'Launch plan');
  await addProperty(page, 'Select', 'Stage');
  await addRow(page, TASKS[0]?.[0] ?? '');
  await pasteIntoGrid(
    page,
    TASKS.map(([title, stage]) => [title, stage]),
  );
  await expect(rowByTitle(page, 'Ship the beta')).toBeVisible();

  await addView(page, 'Board');
  const planned = page.locator('section[data-group-key]', {
    has: page.getByText('Planned', { exact: true }),
  });
  const done = page.locator('section[data-group-key]', {
    has: page.getByText('Done', { exact: true }),
  });
  const card = page.getByRole('button', { name: 'Write the brief', exact: true });
  await expect(planned.getByRole('button', { name: 'Write the brief', exact: true })).toBeVisible();
  await expect(done.getByRole('button', { name: 'Ship the beta', exact: true })).toBeVisible();

  await dragTo(page, card, done);
  await expect(done.getByRole('button', { name: 'Write the brief', exact: true })).toBeVisible();
  await expect(planned.getByRole('button', { name: 'Write the brief', exact: true })).toHaveCount(
    0,
  );

  // The value changed in the database: the table shows it too.
  await page.getByRole('tab', { name: 'Table', exact: true }).click();
  await expect.poll(() => stageOf(page, 'Write the brief')).toBe('Done');

  // Keyboard alternative: the card menu moves it back.
  await page.getByRole('tab', { name: 'Board', exact: true }).click();
  await done.getByRole('button', { name: 'Write the brief', exact: true }).hover();
  await done.getByRole('button', { name: 'Row actions for Write the brief' }).click();
  await page.getByRole('menuitem', { name: 'Move to' }).click();
  await page.getByRole('menuitem', { name: 'Doing', exact: true }).click();
  const doing = page.locator('section[data-group-key]', {
    has: page.getByText('Doing', { exact: true }),
  });
  await expect(doing.getByRole('button', { name: 'Write the brief', exact: true })).toBeVisible();
});

test('reschedules on the calendar by dragging an item and its end', async ({ page }) => {
  await openWorkspace(page);
  await newDatabase(page, 'Editorial calendar');
  await addProperty(page, 'Date', 'Publish');
  await addRow(page, 'Launch post');
  // Days that stay within one week row whatever the month: Tuesday → Thursday of the first full
  // week, and Tuesday → Wednesday of the next week, resized to Friday.
  const monday = firstMonday();
  const launch = dayThisMonth(monday + 1);
  const moved = dayThisMonth(monday + 3);
  const seriesStart = dayThisMonth(monday + 8);
  const seriesEnd = dayThisMonth(monday + 11);
  const series = `${seriesStart} → ${dayThisMonth(monday + 9)}`;
  await pasteIntoGrid(page, [
    ['Launch post', launch],
    ['Interview series', series],
    ['Newsletter', ''],
  ]);
  await expect(rowByTitle(page, 'Newsletter')).toBeVisible();

  await addView(page, 'Calendar');
  const post = page.getByRole('button', { name: new RegExp(`^Launch post, ${fullDate(launch)}`) });
  await expect(post).toBeVisible();

  // Drag the item two days later.
  const target = page.locator(`[data-day="${moved}"]`).first();
  await dragTo(page, post, target, { x: 0, y: 20 });
  await expect(
    page.getByRole('button', { name: new RegExp(`^Launch post, ${fullDate(moved)}`) }),
  ).toBeVisible();

  // Drag the end of the range two days later.
  const interview = page.getByRole('button', { name: /^Interview series,/ });
  await expect(interview).toBeVisible();
  const bar = await interview.boundingBox();
  const end = await page.locator(`[data-day="${seriesEnd}"]`).first().boundingBox();
  if (!bar || !end) throw new Error('calendar not laid out');
  await page.mouse.move(bar.x + bar.width - 3, bar.y + bar.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(
    page.getByRole('button', {
      name: new RegExp(`^Interview series, ${fullDate(seriesStart)} → ${fullDate(seriesEnd)}`),
    }),
  ).toBeVisible();

  // Undated rows wait in the "No date" tray.
  await page.getByRole('button', { name: /^No date/ }).click();
  await expect(
    page
      .getByRole('complementary', { name: 'No date' })
      .getByRole('button', { name: 'Newsletter' }),
  ).toBeVisible();
});
