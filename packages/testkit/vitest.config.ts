import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'testkit',
    environment: 'node',
    // The scripts in `scripts/` have no package of their own; their tests run here.
    include: ['src/**/*.test.{ts,tsx}', '../../scripts/**/*.test.ts'],
  },
});
