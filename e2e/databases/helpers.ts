import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for the databases specs. The skeleton keeps data in memory, so every test starts at
 * onboarding with a fresh workspace.
 */

/** Opens the app and creates an empty workspace. */
export async function openWorkspace(page: Page, name = 'Databases'): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await expect(page.getByRole('button', { name: 'New database', exact: true })).toBeVisible();
}

/** The table grid of the page (a database page shows one). */
export function grid(page: Page): Locator {
  return page.getByRole('grid').first();
}

/** Creates a database from the sidebar, names it and waits for its table. */
export async function newDatabase(page: Page, title: string): Promise<void> {
  await page.getByRole('button', { name: 'New database', exact: true }).click();
  const titleField = page.getByRole('textbox', { name: 'Page title' });
  await expect(titleField).toBeFocused();
  await expect(grid(page)).toBeVisible({ timeout: 20_000 });
  await titleField.fill(title);
}

/** Adds a property with the header's "+" menu and names it. */
export async function addProperty(page: Page, typeLabel: string, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Add a property' }).click();
  await page.getByRole('menuitem', { name: typeLabel, exact: true }).click();
  const rename = page.getByRole('textbox', { name: 'Property name' });
  await expect(rename).toBeFocused();
  await rename.fill(name);
  await rename.press('Enter');
  await expect(page.getByRole('columnheader', { name })).toBeVisible();
}

/** A column header by property name. */
export function header(page: Page, name: string): Locator {
  return grid(page).getByRole('columnheader', { name, exact: true });
}

/** Adds the first row with the table's "New" button and types its title. */
export async function addRow(page: Page, title: string): Promise<void> {
  await grid(page).getByRole('button', { name: 'New', exact: true }).click();
  const editor = page.getByRole('textbox', { name: /^Edit / });
  await expect(editor).toBeFocused();
  await editor.fill(title);
  await editor.press('Enter');
  await expect(rowByTitle(page, title)).toBeVisible();
}

/** Tab-separated values, the clipboard format of spreadsheets. */
export function tsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) =>
      row.map((cell) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join('\t'),
    )
    .join('\n');
}

/**
 * Pastes a block of cells into the table, starting at the first cell of the first row. A synthetic
 * paste event stands in for Ctrl+V: the system clipboard is shared by parallel workers.
 */
export async function pasteIntoGrid(
  page: Page,
  rows: readonly (readonly string[])[],
): Promise<void> {
  await selectFirstCell(page);
  await grid(page).evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    // Firefox gives untrusted clipboard events an empty copy of `clipboardData`: pass ours as is.
    Object.defineProperty(event, 'clipboardData', { value: data });
    element.dispatchEvent(event);
  }, tsv(rows));
}

/** Focuses the table and makes its first cell active (Ctrl or ⌘ + Home). */
export async function selectFirstCell(page: Page): Promise<void> {
  await grid(page).focus();
  await page.keyboard.press('ControlOrMeta+Home');
  await expect(grid(page).locator('[role="gridcell"][data-active]')).toHaveAttribute(
    'aria-colindex',
    '2',
  );
}

/** Copies the selected cells and returns what the table put on the clipboard. */
export async function copyFromGrid(page: Page): Promise<string> {
  return grid(page).evaluate((element) => {
    const data = new DataTransfer();
    const event = new ClipboardEvent('copy', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: data });
    element.dispatchEvent(event);
    return data.getData('text/plain');
  });
}

/** A body row by its title. */
export function rowByTitle(page: Page, title: string): Locator {
  return grid(page)
    .locator('[role="row"][data-row-id]')
    .filter({
      has: page.locator('[role="gridcell"][aria-colindex="2"]', {
        hasText: new RegExp(`^${escape(title)}`),
      }),
    });
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The texts of one column (by header name) for the rendered rows, top to bottom. */
export async function columnTexts(page: Page, name: string): Promise<string[]> {
  const propertyId = await header(page, name).getAttribute('data-property-id');
  return grid(page)
    .locator(`[role="row"][data-row-id] [role="gridcell"][data-property-id="${propertyId}"]`)
    .evaluateAll((cells) =>
      cells.map((cell) => {
        // The text a person reads, without the row's hover buttons ("Open").
        const clone = cell.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('button').forEach((button) => button.remove());
        return (clone.textContent ?? '').trim();
      }),
    );
}

/** The titles of the rendered rows, top to bottom. */
export async function rowTitles(page: Page): Promise<string[]> {
  return grid(page)
    .locator('[role="row"][data-row-id] [role="gridcell"][aria-colindex="2"]')
    .evaluateAll((cells) =>
      cells.map((cell) => {
        // The text a person reads, without the row's hover buttons ("Open").
        const clone = cell.cloneNode(true) as HTMLElement;
        clone.querySelectorAll('button').forEach((button) => button.remove());
        return (clone.textContent ?? '').trim();
      }),
    );
}

/** Picks a value in a Radix select (the trigger is a combobox). */
export async function choose(page: Page, trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Adds a view of a layout with the tabs' "+" menu. */
export async function addView(page: Page, layout: string): Promise<void> {
  await page.getByRole('button', { name: 'Add a view' }).click();
  await page.getByRole('menuitem', { name: layout, exact: true }).click();
  await expect(page.getByRole('tab', { name: layout, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}

/** Drags with the mouse in small steps (dnd-kit needs a few pixels before a drag starts). */
export async function dragTo(
  page: Page,
  source: Locator,
  target: Locator,
  offset = { x: 0, y: 0 },
): Promise<void> {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error('drag source or target is not visible');
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2 + offset.x, to.y + to.height / 2 + offset.y, {
    steps: 20,
  });
  await page.mouse.up();
}

/** What `window.__tessera.diagnostics()` reports (apps/web/src/app/diagnostics.ts). */
export interface Diagnostics {
  contributions: Record<string, string[]>;
  blockKinds: string[];
  commands: string[];
}

export async function readDiagnostics(page: Page): Promise<Diagnostics | null> {
  return page.evaluate(() => {
    const api = (window as unknown as { __tessera?: { diagnostics(): Diagnostics } }).__tessera;
    return api ? api.diagnostics() : null;
  });
}
