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
  await app.page.getByRole('button', { name: 'Sync & account', exact: true }).click();
  const panel = app.page.getByRole('main');
  await expect(panel.getByRole('heading', { name: 'Sync & account' }).first()).toBeVisible({
    timeout: 20_000,
  });
  return panel;
}

/** In the connect form: the server's address, then Continue. */
async function enterServer(scope: Locator, serverUrl: string): Promise<void> {
  // When a server serves the app, the field fills itself with that server once its health check
  // answers; if that lands in the middle of `fill`, the two run together. Fill until it holds.
  const field = scope.getByLabel('Server address');
  await expect(async () => {
    await field.fill(serverUrl);
    await expect(field).toHaveValue(serverUrl, { timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  await scope.getByRole('button', { name: 'Continue', exact: true }).click();
}

/**
 * Connects the open workspace to a server from Settings → Sync & account, signs in with the
 * account and uploads the workspace ("Upload and sync").
 */
export async function connectAndUpload(
  app: TesseraApp,
  serverUrl: string,
  account: Account,
): Promise<void> {
  const panel = await openSyncSettings(app);
  await panel.getByRole('button', { name: 'Connect to a server' }).click();
  await enterServer(panel, serverUrl);
  const signIn = panel.getByRole('form', { name: 'Sign in' });
  await signIn.getByLabel('Email').fill(account.email);
  await signIn.getByLabel('Password').fill(account.password);
  await signIn.getByRole('button', { name: 'Sign in', exact: true }).click();
  await panel.getByRole('button', { name: 'Upload and sync' }).click();
  await expect(syncStatus(app)).toHaveAttribute('data-sync-status', 'synced', {
    timeout: 30_000,
  });
}

/** Creates an invite link in Settings → Sync & account and returns it. */
export async function createInviteLink(app: TesseraApp): Promise<string> {
  const panel = await openSyncSettings(app);
  await panel.getByRole('button', { name: 'Create invite link' }).click();
  const field = panel.getByRole('textbox', { name: 'Invite link' });
  await expect(field).toHaveValue(/^https?:\/\//);
  return field.inputValue();
}

/**
 * Opens an invite link the way an invitee does: the server serves the app, and the link carries
 * the invite. From the first-run screen, "Join a workspace on a server" creates the account and
 * opens the workspace the invite is for.
 */
export async function joinWithInvite(
  app: TesseraApp,
  serverUrl: string,
  invite: string,
  account: Account,
  workspaceName: string,
): Promise<void> {
  await app.page.goto(invite);
  await app.page.getByRole('button', { name: /Join a workspace on a server/ }).click();
  const panel = app.page.getByRole('main');
  await enterServer(panel, serverUrl);
  await panel.getByRole('tab', { name: 'Create account' }).click();
  const form = panel.getByRole('form', { name: 'Create account' });
  await form.getByLabel('Name', { exact: true }).fill(account.name);
  await form.getByLabel('Email').fill(account.email);
  await form.getByLabel('Password').fill(account.password);
  // Servers with invite-only sign-ups ask for the link again when the app wasn't opened with it.
  const inviteField = form.getByLabel('Invite link');
  if (await inviteField.isVisible()) await inviteField.fill(invite);
  await form.getByRole('button', { name: 'Create account', exact: true }).click();
  await panel
    .getByRole('listitem')
    .filter({ hasText: workspaceName })
    .getByRole('button', { name: /^(Join and open|Open)$/ })
    .click();
  await expect(syncStatus(app)).toHaveAttribute('data-sync-status', 'synced', {
    timeout: 30_000,
  });
}

/** The sync status button in the top bar; `data-sync-status` holds its state. */
export function syncStatus(app: TesseraApp): Locator {
  return app.page.getByRole('button', { name: /^Sync status:/ });
}
