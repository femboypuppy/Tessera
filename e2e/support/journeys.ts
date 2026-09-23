/**
 * Helpers the journeys share for features other agents build (editor, palette, side panels). The
 * selectors follow the roles and labels those features use (their `src/i18n/en.ts`); after the
 * merge, fix a selector here once and every journey follows.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { TesseraApp } from '../../packages/testkit/src/playwright';

/** The page body's editor (TipTap renders a contenteditable ProseMirror element). */
export function editor(page: Page): Locator {
  return page.getByRole('main').locator('[contenteditable="true"]').first();
}

/** Moves from the title into the body (Enter in the title focuses the editor) and types. */
export async function writeInBody(app: TesseraApp, lines: readonly string[]): Promise<void> {
  await app.titleField().click();
  await app.titleField().press('End');
  await app.titleField().press('Enter');
  await expect(editor(app.page)).toBeFocused();
  for (const [index, line] of lines.entries()) {
    if (index > 0) await app.page.keyboard.press('Enter');
    await app.page.keyboard.type(line);
  }
}

/**
 * Types `[[query` in the editor and picks `title` from the link menu (or creates the page when it
 * doesn't exist).
 */
export async function insertPageLink(app: TesseraApp, query: string, title: string): Promise<void> {
  await app.page.keyboard.type(`[[${query}`);
  const menu = app.page.getByRole('listbox', { name: /link to a page/i });
  await expect(menu).toBeVisible();
  await menu
    .getByRole('option', { name: new RegExp(title, 'i') })
    .first()
    .click();
  await expect(editor(app.page).getByText(title, { exact: true }).first()).toBeVisible();
}

/** Opens the command palette with Mod+K and returns it. */
export async function openPalette(app: TesseraApp): Promise<Locator> {
  await app.shortcut('Mod+K');
  const palette = app.page.getByRole('dialog', { name: /command palette/i });
  await expect(palette).toBeVisible();
  return palette;
}

/** The palette's input (a combobox, or a plain textbox). */
export function paletteInput(palette: Locator): Locator {
  return palette.getByRole('combobox').or(palette.getByRole('textbox')).first();
}

/** Runs a command by its title through the palette (`>` switches the palette to commands). */
export async function runCommand(app: TesseraApp, title: string): Promise<void> {
  const palette = await openPalette(app);
  await paletteInput(palette).fill(`>${title}`);
  await palette
    .getByRole('option', { name: new RegExp(title, 'i') })
    .first()
    .click();
}

/** Opens a side panel from the top bar (its toggle is labeled with the panel's title). */
export async function openSidePanel(app: TesseraApp, title: RegExp): Promise<Locator> {
  await app.page.getByRole('banner').getByRole('button', { name: title }).click();
  const panel = app.page.getByRole('complementary', { name: title });
  await expect(panel).toBeVisible();
  return panel;
}

export interface Account {
  email: string;
  name: string;
  password: string;
}

/** Opens Settings → "Sync & account". */
export async function openSyncSettings(app: TesseraApp): Promise<Locator> {
  await app.sidebar().getByRole('button', { name: 'Settings' }).click();
  await app.page
    .getByRole('link', { name: /sync & account/i })
    .or(app.page.getByRole('tab', { name: /sync & account/i }))
    .first()
    .click();
  const panel = app.page.getByRole('main');
  await expect(panel.getByRole('heading', { name: /sync & account/i }).first()).toBeVisible();
  return panel;
}

/** Connects the open workspace to a server, signs in and uploads it ("Upload and sync"). */
export async function connectAndUpload(
  app: TesseraApp,
  serverUrl: string,
  account: Account,
): Promise<void> {
  const panel = await openSyncSettings(app);
  await panel.getByRole('textbox', { name: /server address/i }).fill(serverUrl);
  await panel
    .getByRole('button', { name: /connect/i })
    .first()
    .click();
  await panel.getByRole('tab', { name: /sign in/i }).click();
  await panel.getByRole('textbox', { name: /email/i }).fill(account.email);
  await panel.getByLabel(/password/i).fill(account.password);
  await panel.getByRole('button', { name: /^sign in$/i }).click();
  await panel.getByRole('button', { name: /upload and sync/i }).click();
  await expect(syncStatus(app)).toHaveText(/synced/i, { timeout: 30_000 });
}

/** Creates an invite link from the sync settings and returns it. */
export async function createInviteLink(app: TesseraApp): Promise<string> {
  const panel = await openSyncSettings(app);
  await panel.getByRole('button', { name: /create invite link/i }).click();
  const field = panel.getByRole('textbox', { name: /invite link/i }).first();
  await expect(field).toHaveValue(/^https?:\/\//);
  return field.inputValue();
}

/** From the first-run screen: joins a server with an invite, creating the account on the way. */
export async function joinWithInvite(
  app: TesseraApp,
  serverUrl: string,
  invite: string,
  account: Account,
): Promise<void> {
  await app.page.goto('/');
  await app.page
    .getByRole('button', { name: /join|server/i })
    .first()
    .click();
  const dialog = app.page.getByRole('dialog').or(app.page.getByRole('main')).first();
  await dialog.getByRole('textbox', { name: /server address/i }).fill(serverUrl);
  await dialog
    .getByRole('button', { name: /connect/i })
    .first()
    .click();
  await dialog.getByRole('tab', { name: /create account/i }).click();
  await dialog.getByRole('textbox', { name: /name/i }).first().fill(account.name);
  await dialog.getByRole('textbox', { name: /email/i }).fill(account.email);
  await dialog.getByLabel(/password/i).fill(account.password);
  await dialog.getByRole('textbox', { name: /invite link/i }).fill(invite);
  await dialog.getByRole('button', { name: /^create account$/i }).click();
  await dialog.getByRole('button', { name: /join and open/i }).click();
  await expect(syncStatus(app)).toHaveText(/synced/i, { timeout: 30_000 });
}

/** The sync status in the top bar ("Synced", "Offline", "Connecting…"). */
export function syncStatus(app: TesseraApp): Locator {
  return app.page
    .getByRole('banner')
    .getByRole('button', { name: /synced|offline|connecting|syncing|local|error/i })
    .first();
}
