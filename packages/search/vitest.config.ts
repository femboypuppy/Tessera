import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'search',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
