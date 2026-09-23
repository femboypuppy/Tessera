import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const SETUP_CODE = 'E2E-SETUP-CODE';

/** A Tessera sync server started for one Playwright worker. */
export interface SyncServer {
  url: string;
  dataDir: string;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function startSyncServer(
  appOrigin: string,
): Promise<{ server: SyncServer; child: ChildProcess }> {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tessera-e2e-'));
  const port = await freePort();
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: path.join(repoRoot, 'apps/server'),
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      // Both IPv4 and IPv6: browsers and clients may resolve localhost to either.
      HOST: '::',
      LOG_LEVEL: 'warn',
      SIGNUP_MODE: 'open',
      SETUP_CODE,
      CORS_ORIGINS: appOrigin,
      WEB_DIR: path.join(dataDir, 'no-web-build'),
      NODE_ENV: 'production',
    },
    stdio: 'ignore',
  });
  // `localhost` for the app and the server: same site, so the session cookie is sent.
  const url = `http://localhost:${port}`;
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) break;
    } catch {
      // Not up yet.
    }
    if (Date.now() > deadline) throw new Error('The sync server did not start');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  // The owner account, created once per server.
  const setup = await fetch(`${url}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      setupCode: SETUP_CODE,
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'analytical engine',
      client: 'desktop',
    }),
  });
  if (setup.status !== 201) throw new Error(`Owner setup failed: ${setup.status}`);
  return { server: { url, dataDir }, child };
}

export const test = base.extend<{ debugHooks: void }, { syncServer: SyncServer }>({
  syncServer: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures take their dependencies as an object
    async ({}, use, workerInfo) => {
      const baseURL = String(workerInfo.project.use.baseURL ?? 'http://localhost:4173');
      const { server, child } = await startSyncServer(new URL(baseURL).origin);
      await use(server);
      child.kill();
      await new Promise((resolve) => child.once('exit', resolve));
      rmSync(server.dataDir, { recursive: true, force: true });
    },
    { scope: 'worker' },
  ],
  // Turns on `window.__tesseraSync` (page content without the editor, which isn't on this branch).
  debugHooks: [
    async ({ context }, use) => {
      await enableDebugHooks(context);
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export async function enableDebugHooks(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    window.localStorage.setItem('tessera:device:sync.debug', 'true');
  });
}

/** Signs a browser context in to the server (its cookie jar gets the session cookie). */
export async function signIn(
  context: BrowserContext,
  server: SyncServer,
  appOrigin: string,
  account: { email: string; password: string; name?: string },
): Promise<void> {
  const body = { email: account.email, password: account.password };
  let response = await context.request.post(`${server.url}/api/auth/login`, {
    data: body,
    headers: { origin: appOrigin },
  });
  if (response.status() === 401 && account.name) {
    response = await context.request.post(`${server.url}/api/auth/signup`, {
      data: { ...body, name: account.name },
      headers: { origin: appOrigin },
    });
  }
  if (!response.ok())
    throw new Error(`Sign-in failed: ${response.status()} ${await response.text()}`);
}

/** Onboarding: creates an empty local workspace. */
export async function createLocalWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await expect(page.getByText('Your workspace is empty')).toBeVisible();
}

export function sidebar(page: Page) {
  return page.getByRole('navigation', { name: 'Sidebar' });
}

export function pageTree(page: Page) {
  return sidebar(page).getByRole('tree', { name: 'Pages' });
}

/** Creates a page from the sidebar and types its title. Returns the page ID (from the URL). */
export async function createPage(page: Page, title: string): Promise<string> {
  await sidebar(page).getByRole('button', { name: 'New page', exact: true }).first().click();
  const titleField = page.getByRole('textbox', { name: 'Page title' });
  await expect(titleField).toBeFocused();
  await page.keyboard.type(title);
  await expect(pageTree(page).getByRole('treeitem', { name: title, exact: true })).toBeVisible();
  const match = /\/p\/([^/?#]+)/.exec(page.url());
  if (!match?.[1]) throw new Error(`No page ID in ${page.url()}`);
  return decodeURIComponent(match[1]);
}

/** The sync status button in the top bar. */
export function syncStatus(page: Page) {
  return page.getByRole('button', { name: /^Sync status:/ });
}

/** Appends a paragraph to a page through the app's doc handles. */
export async function appendParagraph(page: Page, pageId: string, text: string): Promise<void> {
  await page.waitForFunction(() => window.__tesseraSync !== undefined);
  await page.evaluate(([id, value]) => window.__tesseraSync?.appendParagraph(id, value), [
    pageId,
    text,
  ] as const);
}

/** A page's plain text, read through the app's doc handles. */
export async function readText(page: Page, pageId: string): Promise<string> {
  await page.waitForFunction(() => window.__tesseraSync !== undefined);
  return page.evaluate((id) => window.__tesseraSync?.readText(id) ?? Promise.resolve(''), pageId);
}

/** The open workspace's ID (from the shell's diagnostics). */
export async function workspaceIdOf(page: Page): Promise<string> {
  return page.evaluate(() => {
    const api = (window as unknown as { __tessera?: { diagnostics(): { workspaceId: string } } })
      .__tessera;
    return api?.diagnostics().workspaceId ?? '';
  });
}

/** Connects the open local workspace to the server through Settings (upload). */
export async function uploadWorkspace(page: Page, server: SyncServer): Promise<void> {
  await page.goto('/settings/sync');
  await page.getByRole('button', { name: 'Connect to a server' }).click();
  await page.getByLabel('Server address').fill(server.url);
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Upload and sync' }).click();
  await expect(syncStatus(page)).toHaveAttribute('data-sync-status', 'synced', { timeout: 15_000 });
}

/** Opens a server workspace on this device through the first-run "join" button. */
export async function joinWorkspace(
  page: Page,
  server: SyncServer,
  workspaceName: string,
): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: /Join a workspace on a server/ }).click();
  await page.getByLabel('Server address').fill(server.url);
  await page.getByRole('button', { name: 'Continue' }).click();
  const row = page.getByRole('listitem').filter({ hasText: workspaceName });
  await row.getByRole('button', { name: 'Open' }).click();
  await expect(syncStatus(page)).toHaveAttribute('data-sync-status', 'synced', { timeout: 15_000 });
}

declare global {
  interface Window {
    __tesseraSync?: {
      readText(pageId: string): Promise<string>;
      appendParagraph(pageId: string, text: string): Promise<void>;
      writeDocJSON(pageId: string, json: unknown): Promise<void>;
      status(): { status: string };
    };
  }
}
