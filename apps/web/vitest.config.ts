import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // The shell integration tests render the whole app in jsdom: 4-10 s each alone on a busy
    // machine, and over 15 s when the whole suite shares its CPU.
    testTimeout: 30_000,
    name: 'web',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
