import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'editor',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
