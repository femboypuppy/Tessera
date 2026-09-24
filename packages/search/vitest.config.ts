import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'search',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
    // Integration tests run the real runtime, index and UI; on a busy machine they need more than
    // the default 5 s.
    testTimeout: 20_000,
  },
});
