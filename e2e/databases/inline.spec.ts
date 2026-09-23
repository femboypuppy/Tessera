import { expect, test } from '@playwright/test';
import { openWorkspace, readDiagnostics } from './helpers';

/**
 * An inline database lives inside a page, so this flow needs the editor (Agent 02) to render page
 * bodies and its slash menu. On a branch without the editor it is skipped; the same path (slash
 * item → embed → edit in place) is covered by `apps/web/src/features/databases/databases.test.tsx`.
 */
test('embeds an inline database in a page and edits it there', async ({ page }) => {
  await openWorkspace(page);
  const diagnostics = await readDiagnostics(page);
  test.skip(
    !diagnostics?.contributions.pageBodies?.includes('page'),
    'The editor is not on this branch yet: no page body to type the slash command in.',
  );

  await page.getByRole('button', { name: 'New page', exact: true }).first().click();
  const title = page.getByRole('textbox', { name: 'Page title' });
  await expect(title).toBeFocused();
  await title.fill('Team handbook');
  // The editor loads lazily: wait for its body before Enter moves the caret into it.
  const body = page.getByRole('textbox', { name: 'Page content' });
  await expect(body).toBeVisible({ timeout: 20_000 });
  await title.press('Enter');
  await expect(body).toBeFocused();

  // The slash menu inserts a new database right in the page.
  await page.keyboard.type('/database');
  const item = page
    .getByRole('option', { name: /Database – inline/ })
    .or(page.getByRole('menuitem', { name: /Database – inline/ }))
    .first();
  await expect(item).toBeVisible();
  await item.click();
  const embed = page.locator('[data-inline-database]');
  await expect(embed.getByRole('grid')).toBeVisible({ timeout: 20_000 });

  // Edit it there: name it, add a row with a title.
  await embed.getByRole('button', { name: /^Database title/ }).click();
  await page.getByRole('textbox', { name: 'Database title' }).fill('Onboarding');
  await page.keyboard.press('Enter');
  await embed.getByRole('grid').getByRole('button', { name: 'New', exact: true }).click();
  const editor = page.getByRole('textbox', { name: /^Edit / });
  await expect(editor).toBeFocused();
  await editor.fill('Set up your laptop');
  await editor.press('Enter');
  await expect(embed.getByRole('row', { name: /Set up your laptop/ })).toBeVisible();

  // It is a real database: the full page shows the same row.
  await embed.getByRole('button', { name: 'Open as full page' }).click();
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue('Onboarding');
  await expect(
    page.getByRole('grid').getByRole('row', { name: /Set up your laptop/ }),
  ).toBeVisible();
});
