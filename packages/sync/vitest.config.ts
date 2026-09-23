import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'sync',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
