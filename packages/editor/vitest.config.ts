import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // Under a full `pnpm test` on a busy machine, jsdom tests that take 0.4-0.7 s alone took 5-8 s,
    // and loading lowlight's grammars in a hook took over 10 s.
    testTimeout: 15_000,
    hookTimeout: 30_000,
    name: 'editor',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
  },
});
