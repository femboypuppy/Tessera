import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'desktop',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
