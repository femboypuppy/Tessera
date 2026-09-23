import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for the shell specs. The web app keeps workspaces in memory until the storage feature
 * lands, so every test starts at onboarding and a reload starts over.
 */

/** Opens the app and creates an empty workspace through onboarding. Returns the sidebar. */
export async function createWorkspace(page: Page, name: string): Promise<Locator> {
  await page.goto('/');
  const nameField = page.getByLabel('Workspace name');
  await nameField.fill(name);
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await expect(page.getByText('Your workspace is empty')).toBeVisible();
  return page.getByRole('navigation', { name: 'Sidebar' });
}

/** The sidebar page tree. */
export function pageTree(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Sidebar' }).getByRole('tree', { name: 'Pages' });
}

/** Creates a page with the sidebar's "New page" row and types its title. */
export async function createPage(page: Page, title: string): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Sidebar' })
    .getByRole('button', { name: 'New page', exact: true })
    .first()
    .click();
  const titleField = page.getByRole('textbox', { name: 'Page title' });
  await expect(titleField).toBeFocused();
  await expect(titleField).toHaveValue('');
  await page.keyboard.type(title);
  await expect(pageTree(page).getByRole('treeitem', { name: title, exact: true })).toBeVisible();
}

/** Titles and levels of the visible tree rows, top to bottom (for example `Alpha:1`). */
export async function treeOutline(page: Page): Promise<string[]> {
  return pageTree(page)
    .getByRole('treeitem')
    .evaluateAll((items) =>
      items.map(
        (item) =>
          `${item.getAttribute('aria-label') ?? ''}:${item.getAttribute('aria-level') ?? ''}`,
      ),
    );
}
