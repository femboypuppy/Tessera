import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/**
 * Screenshot runs (`pnpm screenshots`). Every `e2e/<area>/*.screenshots.ts` file runs in Chromium
 * at 1440×900 and writes `assets/screenshots/<area>/<name>-light.png` and `<name>-dark.png`.
 * `pnpm test:e2e` only matches `*.spec.ts`, so normal test runs never rewrite tracked images.
 *
 * Run one area: `pnpm screenshots e2e/editor`. It uses the same web server and port as the e2e
 * config (`E2E_DEV=1` for the dev server).
 */
export default defineConfig({
  ...base,
  testMatch: '**/*.screenshots.ts',
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  projects: [
    {
      name: 'screenshots',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
});
