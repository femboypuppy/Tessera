import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    // The React binding tests (jsdom) pay for the runtime's first dynamic imports, 2 s alone and
    // over 5 s when the whole suite shares the CPU.
    testTimeout: 15_000,
    name: 'core',
    environment: 'node',
  },
});
