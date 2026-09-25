import { expect, test, type Page } from '@playwright/test';
import { formatViolations, scanAccessibility } from '../support';

/**
 * The design pass (agents/12-polish.md §2): every screen of the demo workspace, in both themes,
 * passes axe's WCAG 2.x A and AA rules (contrast included) with no serious or critical issue,
 * and no baseline of known ones.
 */

const THEMES = ['light', 'dark'] as const;

const sidebar = (page: Page) => page.getByRole('navigation', { name: 'Sidebar' });
const tree = (page: Page) => sidebar(page).getByRole('tree', { name: 'Pages' });
const title = (page: Page) => page.getByRole('textbox', { name: 'Page title' });

async function openDemo(page: Page, colorScheme: 'light' | 'dark'): Promise<void> {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: /Open the demo workspace/ }).click();
  await expect(title(page)).toHaveValue('Welcome to Tessera', { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
}

async function openPage(page: Page, name: string, parent?: string): Promise<void> {
  if (parent) {
    const row = tree(page).getByRole('treeitem', { name: parent, exact: true });
    if ((await row.getAttribute('aria-expanded')) === 'false') {
      await row.focus();
      await page.keyboard.press('ArrowRight');
    }
  }
  await tree(page).getByRole('treeitem', { name, exact: true }).click();
  await expect(title(page)).toHaveValue(name);
}

/** Checks the screen as it is now; `screen` names it in the failure message. */
async function expectAccessible(page: Page, screen: string): Promise<void> {
  // Settle entrance animations and lazy content before measuring colors.
  await page.waitForTimeout(300);
  const violations = await scanAccessibility(page);
  // Soft: one run lists the issues of every screen.
  expect.soft(violations, `${screen}\n${formatViolations(violations)}`).toEqual([]);
}

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test('pages: welcome, every block type, a note with backlinks', async ({ page }) => {
      test.setTimeout(120_000);
      await openDemo(page, theme);
      await expectAccessible(page, 'Welcome to Tessera');

      await openPage(page, 'Every block type');
      await expect(page.locator('.tess-editor pre').first()).toBeVisible();
      await expectAccessible(page, 'Every block type');

      await openPage(page, 'Apollo 11', 'Knowledge garden');
      await page
        .getByRole('banner')
        .getByRole('button', { name: /^Backlinks/ })
        .click();
      await expect(
        page
          .getByRole('complementary', { name: /Backlinks/ })
          .getByText('Apollo program')
          .first(),
      ).toBeVisible({ timeout: 15_000 });
      await expectAccessible(page, 'Apollo 11 with backlinks');
    });

    test('menus: slash menu, link menu, palette', async ({ page }) => {
      test.setTimeout(120_000);
      await openDemo(page, theme);
      await openPage(page, 'Inbox');
      await page.getByRole('textbox', { name: 'Page content' }).click();
      await page.keyboard.press('ControlOrMeta+End');
      await page.keyboard.press('Enter');
      await page.keyboard.type('/');
      await expect(page.getByRole('listbox', { name: 'Insert a block' })).toBeVisible();
      await expectAccessible(page, 'slash menu');
      // Escape leaves the "/" in the text; links start after a space or at a line start.
      await page.keyboard.press('Escape');
      await page.keyboard.press('Backspace');
      await page.keyboard.type('[[apollo');
      await expect(page.getByRole('listbox', { name: /link to a page/i })).toBeVisible();
      await expectAccessible(page, 'link menu');
      await page.keyboard.press('Escape');

      await page.keyboard.press('ControlOrMeta+k');
      await page.keyboard.type('saturn');
      const palette = page.getByRole('dialog', { name: /command palette/i });
      await expect(palette.getByRole('option').first()).toBeVisible();
      await expectAccessible(page, 'palette with results');
    });

    test('databases: board, table, calendar, reading list', async ({ page }) => {
      test.setTimeout(120_000);
      await openDemo(page, theme);
      await openPage(page, 'Projects');
      await expect(page.locator('section[data-group-key]').first()).toBeVisible();
      await expectAccessible(page, 'Projects board');
      await page.getByRole('tab', { name: 'Table', exact: true }).click();
      await expect(page.getByRole('grid').first()).toBeVisible();
      await expectAccessible(page, 'Projects table');
      // Grouped, the table has group headers and a "New" row per group.
      await page.getByRole('button', { name: 'Group', exact: true }).click();
      await page.getByRole('menuitemradio', { name: 'Status' }).click();
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button', { name: /^Collapse / }).first()).toBeVisible();
      await expectAccessible(page, 'Projects table, grouped');
      await page.getByRole('button', { name: 'Group: Status' }).click();
      await page.getByRole('menuitemradio', { name: 'None' }).click();
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
      await expect(page.getByRole('tab', { name: 'Calendar', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expectAccessible(page, 'Projects calendar');
      await openPage(page, 'Reading list');
      await expect(page.getByRole('grid').first()).toBeVisible();
      await expectAccessible(page, 'Reading list');
    });

    test('dialogs and settings: import, export, shortcuts, every settings section, trash', async ({
      page,
    }) => {
      test.setTimeout(150_000);
      await openDemo(page, theme);
      await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Import' })).toBeVisible();
      await expectAccessible(page, 'import dialog');
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Page actions' }).click();
      await page.getByRole('menuitem', { name: 'Export…' }).click();
      await expect(page.getByRole('dialog', { name: 'Export' })).toBeVisible();
      await expectAccessible(page, 'export dialog');
      await page.keyboard.press('Escape');

      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
      await expectAccessible(page, 'shortcuts overlay');
      await page.keyboard.press('Escape');

      await sidebar(page).getByRole('button', { name: 'Settings' }).click();
      await expect(page.getByRole('heading', { name: 'Appearance' })).toBeVisible();
      await expectAccessible(page, 'settings: General');
      const sections = page.getByRole('navigation', { name: /Settings/ }).getByRole('button');
      const names = (await sections.allInnerTexts()).map((name) => name.trim()).filter(Boolean);
      expect(names.length).toBeGreaterThan(3);
      for (const name of names.slice(1)) {
        await page.getByRole('button', { name, exact: true }).click();
        await expect(page.getByRole('heading', { name }).first()).toBeVisible({ timeout: 15_000 });
        await expectAccessible(page, `settings: ${name}`);
      }

      await openPage(page, 'Inbox');
      await page.getByRole('button', { name: 'Page actions' }).click();
      await page.getByRole('menuitem', { name: 'Move to trash' }).click();
      await sidebar(page).getByRole('button', { name: 'Trash' }).click();
      await expect(page.getByText('Inbox').first()).toBeVisible();
      await expectAccessible(page, 'trash');
    });
  });
}
