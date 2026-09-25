import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * The first-run audit (agents/12-polish.md §1): a brand-new user's first minutes, in a fresh
 * browser profile, one screenshot per step in both themes. `pnpm screenshots e2e/polish` writes
 * `assets/screenshots/polish/first-run/NN-<step>-{light,dark}.png` and the time each step took to
 * `assets/screenshots/polish/first-run/timings.json`; `HANDOFF/polish.md` reviews them.
 */
const OUT = fileURLToPath(new URL('../../assets/screenshots/polish/first-run/', import.meta.url));

const timings: Array<{ step: string; ms: number }> = [];

/** Runs one step of the walk-through and records how long it took. */
async function step(name: string, run: () => Promise<void>): Promise<void> {
  const started = performance.now();
  await test.step(name, run);
  timings.push({ step: name, ms: Math.round(performance.now() - started) });
}

/** Captures the current view in the light and the dark theme (the app follows the system). */
async function snap(page: Page, name: string, { keepFocus = false } = {}): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  // No stray hover in the pictures (menus that close on blur keep their focus).
  await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  if (!keepFocus) {
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

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const tree = (page: Page) => sidebar(page).getByRole('tree', { name: 'Pages' });
const title = (page: Page) => page.getByRole('textbox', { name: 'Page title' });
const body = (page: Page) => page.getByRole('textbox', { name: 'Page content' });

test('first run: a new user from the landing screen to dark mode', async ({ page }) => {
  test.setTimeout(240_000);

  await step('landing', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await snap(page, '01-landing');
  });

  await step('onboarding', async () => {
    const demo = page.getByRole('button', { name: /Open the demo workspace/ });
    await expect(demo).toBeVisible();
    await demo.hover();
    await snap(page, '02-onboarding', { keepFocus: true });
  });

  await step('demo workspace', async () => {
    await page.getByRole('button', { name: /Open the demo workspace/ }).click();
    await expect(title(page)).toHaveValue('Welcome to Tessera', { timeout: 30_000 });
    await expect(body(page)).toBeVisible();
    await expect(tree(page).getByRole('treeitem', { name: 'Projects', exact: true })).toBeVisible();
    await snap(page, '03-demo-workspace');
  });

  await step('create a page', async () => {
    await sidebar(page).getByRole('button', { name: 'New page', exact: true }).first().click();
    await expect(title(page)).toBeFocused();
    await expect(body(page)).toBeVisible();
    await snap(page, '04-new-page', { keepFocus: true });
    await page.keyboard.type('Exhibit launch checklist');
    await page.keyboard.press('Enter');
    await expect(body(page)).toBeFocused();
    await page.keyboard.type('Everything left before the museum opens the space gallery.');
    await page.keyboard.press('Enter');
  });

  await step('slash menu', async () => {
    await page.keyboard.type('/');
    const menu = page.getByRole('listbox', { name: 'Insert a block' });
    await expect(menu).toBeVisible();
    await snap(page, '05-slash-menu', { keepFocus: true });
    await page.keyboard.type('to-do');
    await expect(menu.getByRole('option').first()).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(menu).toBeHidden();
    await page.keyboard.type('Print the timeline banner');
    await page.keyboard.press('Enter');
    await page.keyboard.type('Test the Saturn V model lighting');
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
  });

  await step('link pages', async () => {
    await page.keyboard.type('Background reading: ');
    await page.keyboard.type('[[apollo 1');
    const menu = page.getByRole('listbox', { name: /link to a page/i });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('option', { name: /Apollo 11/ }).first()).toBeVisible();
    await snap(page, '06-link-menu', { keepFocus: true });
    await menu
      .getByRole('option', { name: /Apollo 11/ })
      .first()
      .click();
    await expect(body(page).getByText('Apollo 11', { exact: true })).toBeVisible();
    // The link leaves a space after itself, so the sentence goes on without one.
    await page.keyboard.type('and the Saturn V page.');
    await snap(page, '07-linked');
    await body(page).getByText('Apollo 11', { exact: true }).click();
    await expect(title(page)).toHaveValue('Apollo 11');
    await page
      .getByRole('banner')
      .getByRole('button', { name: /^Backlinks/ })
      .click();
    const panel = page.getByRole('complementary', { name: /Backlinks/ });
    await expect(panel.getByText('Exhibit launch checklist').first()).toBeVisible({
      timeout: 15_000,
    });
    await snap(page, '08-backlinks');
    await page
      .getByRole('banner')
      .getByRole('button', { name: /^Backlinks/ })
      .click();
  });

  await step('search', async () => {
    await page.keyboard.press('ControlOrMeta+k');
    const palette = page.getByRole('dialog', { name: /command palette/i });
    await expect(palette).toBeVisible();
    await snap(page, '09-palette-empty', { keepFocus: true });
    await page.keyboard.type('saturn');
    await expect(palette.getByRole('option').first()).toBeVisible();
    await snap(page, '10-search', { keepFocus: true });
    await page.keyboard.press('Enter');
    await expect(palette).toBeHidden();
  });

  await step('database', async () => {
    await tree(page).getByRole('treeitem', { name: 'Projects', exact: true }).click();
    await expect(title(page)).toHaveValue('Projects');
    // The demo's project tracker opens on its board, grouped by status.
    await expect(page.getByRole('tab', { name: 'Board', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
      { timeout: 20_000 },
    );
    await expect(page.locator('section[data-group-key]').first()).toBeVisible();
    await snap(page, '11-database-board');
    await page.getByRole('tab', { name: 'Table', exact: true }).click();
    await expect(page.getByRole('grid').first()).toBeVisible();
    await snap(page, '12-database-table');
  });

  await step('graph', async () => {
    await sidebar(page).getByRole('button', { name: 'Graph view' }).click();
    await expect(page.getByRole('img', { name: /Graph view: \d+ pages/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole('status').filter({ hasText: /pages · \d+ links/ })).toBeVisible();
    // Let the layout settle before the picture.
    await page.waitForTimeout(4_000);
    await snap(page, '13-graph');
  });

  await step('import', async () => {
    await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Import' });
    await expect(dialog).toBeVisible();
    await snap(page, '14-import');
    await dialog.getByTestId('import-files-input').setInputFiles([
      {
        name: 'Field notes.md',
        mimeType: 'text/markdown',
        buffer: Buffer.from(
          '# Field notes\n\nNotes from the planetarium visit. See [[Apollo 11]].\n\n- [ ] Ask about the lunar sample\n',
        ),
      },
    ]);
    const start = dialog.getByRole('button', { name: /^Import \d+ files?$/ });
    await expect(start).toBeVisible();
    await snap(page, '15-import-ready', { keepFocus: true });
    await start.click();
    const report = page.getByRole('dialog', { name: 'Import complete' });
    await expect(report).toBeVisible({ timeout: 30_000 });
    await snap(page, '16-import-report');
    await page.keyboard.press('Escape');
    await expect(report).toBeHidden();
  });

  await step('settings', async () => {
    await sidebar(page).getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
    await snap(page, '17-settings');
  });

  await step('dark mode', async () => {
    await page.getByRole('radio', { name: 'Dark' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    mkdirSync(OUT, { recursive: true });
    await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
    await page.screenshot({ path: `${OUT}18-dark-mode.png`, animations: 'disabled' });
    await tree(page).getByRole('treeitem', { name: 'Welcome to Tessera', exact: true }).click();
    await expect(title(page)).toHaveValue('Welcome to Tessera');
    await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
    await page.screenshot({ path: `${OUT}19-dark-page.png`, animations: 'disabled' });
  });

  writeFileSync(`${OUT}timings.json`, `${JSON.stringify(timings, null, 2)}\n`);
});

test('first run at phone width', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });

  await page.goto('/');
  await expect(page.getByRole('button', { name: /Open the demo workspace/ })).toBeVisible();
  await snap(page, 'phone-01-onboarding');

  await page.getByRole('button', { name: /Open the demo workspace/ }).click();
  await expect(title(page)).toHaveValue('Welcome to Tessera', { timeout: 30_000 });
  await snap(page, 'phone-02-page');

  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(tree(page)).toBeVisible();
  await snap(page, 'phone-03-sidebar', { keepFocus: true });
  await tree(page).getByRole('treeitem', { name: 'Projects', exact: true }).click();
  await expect(title(page)).toHaveValue('Projects');
  await snap(page, 'phone-04-database');

  // Typed at once, the way people do: the palette keeps it even while its code loads.
  await page.keyboard.press('ControlOrMeta+k');
  await page.keyboard.type('gagarin');
  const palette = page.getByRole('dialog', { name: /command palette/i });
  await expect(palette.getByRole('combobox')).toHaveValue('gagarin');
  await expect(palette.getByRole('option').first()).toBeVisible();
  await snap(page, 'phone-05-search', { keepFocus: true });
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveValue('Yuri Gagarin');
  await snap(page, 'phone-06-note');
});
