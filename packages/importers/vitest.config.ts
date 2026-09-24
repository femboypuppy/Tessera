import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'importers',
    // Importers run in Node (as in a worker); UI tests opt into jsdom with a docblock.
    environment: 'node',
    setupFiles: ['@tessera/core/testing/setup-dom', './src/test/setup.ts'],
    // Tests run whole imports (files, codec, worker planner, workspace writes): give them room
    // when the rest of the monorepo's suite shares the machine.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
