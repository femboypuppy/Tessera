import { defineConfig } from 'vitest/config';

/**
 * Root Vitest config. Every folder in `packages/*` and `apps/*` is a project; each one keeps its
 * own `vitest.config.ts` (environment, setup files). Adding a package never needs a root edit.
 */
export default defineConfig({
  test: {
    projects: ['packages/*', 'apps/*'],
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov', 'json-summary'],
      reportsDirectory: 'coverage',
      include: ['packages/*/src/**', 'apps/*/src/**'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', '**/test/**'],
    },
  },
});
