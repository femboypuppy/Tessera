import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'db-views',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
