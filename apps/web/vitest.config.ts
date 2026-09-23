import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // The shell integration tests render the whole app in jsdom (4-10 s each on a busy machine).
    testTimeout: 15_000,
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
