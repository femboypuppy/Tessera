import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'plugins',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
