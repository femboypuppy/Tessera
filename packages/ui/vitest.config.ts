import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // jsdom role queries are slow on big DOMs: the EmojiPicker test queries ~1,870 buttons by
    // accessible name (about 10 s on a busy machine, 1 s of it rendering). Nothing hangs.
    testTimeout: 15_000,
    name: 'ui',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
