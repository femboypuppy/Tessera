import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'markdown',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
