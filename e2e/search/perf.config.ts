import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import base from '../../playwright.config';

/**
 * Performance runs for search and the graph (not part of `pnpm test:e2e`; they seed thousands of
 * pages and take minutes):
 *
 *   pnpm exec playwright test -c e2e/search/perf.config.ts
 *
 * Same web server and port as the e2e config, one Chromium worker, results printed to the console.
 */
export default defineConfig({
  ...base,
  testDir: fileURLToPath(new URL('.', import.meta.url)),
  testMatch: '**/*.perf.ts',
  outputDir: fileURLToPath(new URL('../../test-results/search-perf', import.meta.url)),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 20 * 60_000,
  projects: [
    {
      name: 'perf',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        // Headless Chromium draws WebGL on the CPU (SwiftShader) unless told to use the GPU.
        // PERF_SOFTWARE_GL=1 keeps the software renderer (a worst case, like a machine without a GPU).
        launchOptions: {
          args:
            process.env.PERF_SOFTWARE_GL === '1'
              ? []
              : ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'],
        },
      },
    },
  ],
});
