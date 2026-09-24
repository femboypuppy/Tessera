/**
 * Playwright fixtures for Tessera:
 *
 * - `app`: helpers for the shell (`TesseraApp`) on the test's page.
 * - `freshWorkspace`: the app with a new, empty workspace (through onboarding).
 * - `seededWorkspace`: the seeded harness with a generated workspace (`test.use({ seedOptions })`).
 * - `syncServer` (worker): a real Tessera server on a free port with temporary data.
 * - `collaborators`: two users (separate browser contexts) and the server, for collaboration.
 *
 * @example
 * import { test, expect } from '../support';
 * test.use({ seedOptions: { seed: 7, pages: 300 } });
 * test('search a seeded workspace', async ({ seededWorkspace }) => { … });
 */
import { fileURLToPath } from 'node:url';
import { test as base, expect } from '@playwright/test';
import type { GenerateOptions } from '../generator';
import type { HarnessState } from '../harness-state';
import { TesseraApp } from './app';
import { startHarness, type HarnessServer } from './harness-server';
import { startSyncServer, type SyncServer } from './sync-server';

/** The serializable part of the harness state. */
export type SeededState = Omit<HarnessState, 'ctx' | 'markdownFiles'>;

export interface SeededWorkspace {
  app: TesseraApp;
  state: SeededState;
  url: string;
}

export interface Collaborators {
  server: SyncServer;
  alice: TesseraApp;
  bob: TesseraApp;
}

export interface TesseraFixtures {
  app: TesseraApp;
  freshWorkspace: TesseraApp;
  seedOptions: GenerateOptions;
  seededWorkspace: SeededWorkspace;
  collaborators: Collaborators;
}

export interface TesseraWorkerFixtures {
  harness: HarnessServer;
  syncServer: SyncServer;
}

export const test = base.extend<TesseraFixtures, TesseraWorkerFixtures>({
  app: async ({ page }, provide) => {
    await provide(new TesseraApp(page));
  },

  freshWorkspace: async ({ app }, provide) => {
    await app.createWorkspace();
    await provide(app);
  },

  seedOptions: [{ seed: 1, pages: 120 }, { option: true }],

  harness: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern even without dependencies.
    async ({}, provide, workerInfo) => {
      // One dependency cache per worker: parallel dev servers must not optimize into one folder.
      const harness = await startHarness({
        cacheDir: fileURLToPath(
          new URL(
            `../../node_modules/.vite-harness-worker-${workerInfo.parallelIndex}`,
            import.meta.url,
          ),
        ),
      });
      await provide(harness);
      await harness.close();
    },
    { scope: 'worker', timeout: 120_000 },
  ],

  seededWorkspace: [
    async ({ page, harness, seedOptions }, provide) => {
      const url = harness.url(seedOptions);
      await page.goto(url);
      await page.waitForFunction(
        () => window.__tesseraHarness?.ready === true || Boolean(window.__tesseraHarness?.error),
        null,
        { timeout: 90_000 },
      );
      const state = await page.evaluate((): SeededState | { error: string } => {
        const harnessState = window.__tesseraHarness;
        if (!harnessState) return { error: 'The harness did not start' };
        if (harnessState.error) return { error: harnessState.error };
        const { ctx: _ctx, markdownFiles: _files, ...rest } = harnessState;
        return rest;
      });
      if ('error' in state && typeof state.error === 'string' && !('pages' in state)) {
        throw new Error(`The seeded harness failed: ${state.error}`);
      }
      await provide({ app: new TesseraApp(page), state: state as SeededState, url });
    },
    // Loading the whole app from the harness's dev server and generating the workspace gets its
    // own budget (36 s here once the editor was registered), so it doesn't eat the test's.
    { timeout: 120_000 },
  ],

  syncServer: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires a destructuring pattern even without dependencies.
    async ({}, provide, workerInfo) => {
      // The app under test runs on another origin than the server: allow it (CORS_ORIGINS).
      const baseURL = workerInfo.project.use.baseURL;
      const server = await startSyncServer(
        baseURL ? { corsOrigins: [new URL(baseURL).origin] } : {},
      );
      await provide(server);
      await server.stop();
    },
    { scope: 'worker', timeout: 120_000 },
  ],

  collaborators: async ({ browser, syncServer, baseURL }, provide) => {
    const contexts = await Promise.all([
      browser.newContext({ baseURL }),
      browser.newContext({ baseURL }),
    ]);
    const [alice, bob] = await Promise.all(contexts.map((context) => context.newPage()));
    if (!alice || !bob) throw new Error('Could not open two pages');
    await provide({ server: syncServer, alice: new TesseraApp(alice), bob: new TesseraApp(bob) });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };
