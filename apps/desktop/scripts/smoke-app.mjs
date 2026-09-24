#!/usr/bin/env node
/**
 * Smoke test of the real desktop app (Windows: WebView2 exposes the Chrome DevTools Protocol).
 *
 *   pnpm --filter @tessera/desktop exec tauri build --debug --no-bundle
 *   node apps/desktop/scripts/smoke-app.mjs [path/to/tessera-desktop.exe]
 *
 * It starts the app with its config and workspaces in a temporary folder, creates a workspace
 * and a page through the UI, checks that `tessera.db` appeared in the workspace folder, quits
 * (through the app's flush-then-exit path), starts the app again and checks the page is still
 * there. With `--screenshots <dir>` it also saves pictures of the real window.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const shotsIndex = args.indexOf('--screenshots');
const screenshotsDir = shotsIndex >= 0 ? path.resolve(args[shotsIndex + 1] ?? 'screenshots') : null;
const exe =
  args.find(
    (arg, index) => !arg.startsWith('--') && (shotsIndex < 0 || index !== shotsIndex + 1),
  ) ?? path.join(here, '..', 'src-tauri', 'target', 'debug', 'tessera-desktop.exe');
const port = 9333;

if (process.platform !== 'win32') {
  console.error('This smoke test drives WebView2 over CDP, so it runs on Windows only.');
  process.exit(2);
}
if (!existsSync(exe)) {
  console.error(`App not found: ${exe}. Build it with "tauri build --debug --no-bundle".`);
  process.exit(2);
}

const root = mkdtempSync(path.join(tmpdir(), 'tessera-smoke-'));
const configDir = path.join(root, 'config');
const workspacesDir = path.join(root, 'workspaces');
mkdirSync(workspacesDir, { recursive: true });

function launch() {
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      TESSERA_CONFIG_DIR: configDir,
      TESSERA_WORKSPACES_DIR: workspacesDir,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', () => undefined);
  child.stderr.on('data', () => undefined);
  const exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return { child, exited };
}

async function waitForDevtools() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The app did not expose DevTools within 60 s');
}

/** WebView2 keeps the DevTools port for a moment after the app exits. */
async function waitForPortFree() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/json/version`);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The previous app instance kept the DevTools port');
}

async function findPage(browser, predicate, what) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) if (predicate(page.url())) return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No ${what} found`);
}

async function mainPage(browser) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        const url = page.url();
        if (!url.includes('/capture') && /tauri\.localhost|localhost:5173/.test(url)) return page;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('No main window page found');
}

async function step(name, action) {
  process.stdout.write(`- ${name}… `);
  const started = Date.now();
  const result = await action();
  console.info(`ok (${Date.now() - started} ms)`);
  return result;
}

async function quit(page, exited) {
  // The same path as File → Quit: every window flushes, the databases close, then the app exits.
  await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('app_quit'));
  const code = await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('The app did not quit')), 15_000)),
  ]);
  if (code !== 0) throw new Error(`The app exited with code ${code}`);
}

let failed = false;
try {
  console.info(`Tessera desktop smoke test\n  app: ${exe}\n  data: ${root}`);
  let app = launch();
  await step('start and expose DevTools', waitForDevtools);
  let browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let page = await mainPage(browser);
  await step('onboarding: create a workspace', async () => {
    await page.getByLabel('Workspace name').fill('Smoke test');
    await page.getByRole('button', { name: 'Create an empty workspace' }).click();
    await page.getByText('Your workspace is empty').waitFor();
  });
  const services = await step('desktop services are in use', async () => {
    const diagnostics = await page.evaluate(() => window.__tessera.diagnostics());
    const { docStore, assetStore, workspaceRegistry, credentialStore } = diagnostics.services;
    if (
      docStore !== 'tauri-sqlite' ||
      assetStore !== 'tauri-files' ||
      workspaceRegistry !== 'tauri-folders' ||
      credentialStore !== 'keychain'
    )
      throw new Error(`unexpected services ${JSON.stringify(diagnostics.services)}`);
    return diagnostics.services;
  });
  await step('plugin sandboxes run under the app CSP (page nonce, blob: modules)', async () => {
    // What the plugin host does: a sandboxed srcdoc frame (which inherits the app's policy) runs
    // a bootstrap carrying the page's nonce, which loads code from a blob: URL.
    const result = await page.evaluate(async () => {
      const nonce = document.querySelector('meta[property="csp-nonce"]')?.nonce ?? '';
      if (!nonce || nonce.startsWith('__')) return `no CSP nonce in the page (${nonce || 'empty'})`;
      const frame = document.createElement('iframe');
      frame.setAttribute('sandbox', 'allow-scripts');
      frame.style.display = 'none';
      const bootstrap =
        "const url = URL.createObjectURL(new Blob(['export default 42'], { type: 'text/javascript' }));" +
        "import(url).then((m) => parent.postMessage({ smoke: m.default }, '*'), (e) => parent.postMessage({ smoke: String(e) }, '*'));";
      frame.srcdoc = `<script nonce="${nonce}">${bootstrap}</script>`;
      const answer = new Promise((resolve) => {
        const timer = setTimeout(() => resolve('the frame bootstrap never ran'), 10_000);
        addEventListener('message', (event) => {
          if (event.source !== frame.contentWindow || event.data?.smoke === undefined) return;
          clearTimeout(timer);
          resolve(event.data.smoke);
        });
      });
      document.body.append(frame);
      const value = await answer;
      frame.remove();
      return value;
    });
    if (result !== 42) throw new Error(`plugin sandbox check: ${result}`);
  });
  await step('create a page', async () => {
    await page
      .getByRole('navigation', { name: 'Sidebar' })
      .getByRole('button', { name: 'New page', exact: true })
      .first()
      .click();
    await page.keyboard.type('Hello from the desktop');
    await page
      .getByRole('navigation', { name: 'Sidebar' })
      .getByRole('treeitem', { name: 'Hello from the desktop' })
      .waitFor();
  });
  const dbFile = path.join(workspacesDir, 'Smoke test', 'tessera.db');
  await step('tessera.db exists in the workspace folder', async () => {
    const deadline = Date.now() + 10_000;
    while (!existsSync(dbFile)) {
      if (Date.now() > deadline) throw new Error(`${dbFile} was not created`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  });
  await step('quick capture writes to the Inbox, seen live by the main window', async () => {
    await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('capture_show'));
    const capture = await findPage(browser, (url) => url.includes('/capture'), 'capture window');
    const field = capture.getByRole('textbox', { name: 'Quick capture' });
    await field.waitFor({ timeout: 30_000 });
    if (screenshotsDir) {
      mkdirSync(screenshotsDir, { recursive: true });
      await field.fill('Call the machine shop about the heat shield');
      await capture.screenshot({ path: path.join(screenshotsDir, 'real-quick-capture.png') });
      await field.fill('');
    }
    await field.fill('Call the machine shop about the heat shield');
    await field.press('Enter');
    await capture.getByText('Added to Inbox').waitFor();
    // Created by the capture window, relayed by Rust to the main window's workspace doc.
    await page
      .getByRole('navigation', { name: 'Sidebar' })
      .getByRole('treeitem', { name: 'Inbox' })
      .waitFor({ timeout: 10_000 });
  });
  const pageId = await page.evaluate(() => location.pathname.split('/').pop());
  await step('a tessera:// link to a second launch opens the page in the running app', async () => {
    await page
      .getByRole('navigation', { name: 'Sidebar' })
      .getByRole('treeitem', { name: 'Inbox' })
      .click();
    await page.waitForURL((url) => !url.pathname.endsWith(pageId ?? ''));
    const second = spawn(exe, [`tessera://open/${pageId}`], {
      env: { ...process.env, TESSERA_CONFIG_DIR: configDir, TESSERA_WORKSPACES_DIR: workspacesDir },
      stdio: 'ignore',
    });
    await new Promise((resolve) => second.on('exit', resolve));
    await page.waitForURL((url) => url.pathname === `/p/${pageId}`, { timeout: 10_000 });
  });
  if (screenshotsDir) {
    mkdirSync(screenshotsDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotsDir, 'real-desktop-window.png') });
  }
  await step('quit (flush, close databases, exit 0)', () => quit(page, app.exited));
  await browser.close().catch(() => undefined);
  await waitForPortFree();

  app = launch();
  await step('start again', waitForDevtools);
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = await mainPage(browser);
  await step('the workspace and the page are still there', async () => {
    await page
      .getByRole('navigation', { name: 'Sidebar' })
      .getByRole('treeitem', { name: 'Hello from the desktop' })
      .waitFor({ timeout: 20_000 });
  });
  await step('quit again', () => quit(page, app.exited));
  await browser.close().catch(() => undefined);
  console.info(`\nPASS (${JSON.stringify(services)})`);
} catch (error) {
  failed = true;
  console.error(`\nFAIL: ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
