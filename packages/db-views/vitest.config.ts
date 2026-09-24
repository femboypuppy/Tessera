import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db-views',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
    // Property tests run thousands of cases; on a busy machine one can pass 5 s (8 s measured).
    testTimeout: 15_000,
  },
});
