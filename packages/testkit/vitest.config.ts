import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // The React helpers' tests render seeded workspaces in jsdom (0.5 s alone, 7 s under a full
    // `pnpm test` on a busy machine); CI runs every test with 20 s too.
    testTimeout: 20_000,
    name: 'testkit',
    environment: 'node',
    // The scripts in `scripts/` have no package of their own; their tests run here.
    include: ['src/**/*.test.{ts,tsx}', '../../scripts/**/*.test.ts'],
  },
});
