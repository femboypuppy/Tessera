import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'sync',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
    // IndexedDB-backed runtimes and Radix popovers are slow to start in jsdom under load.
    testTimeout: 20_000,
  },
});
