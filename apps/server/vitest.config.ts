import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // These tests start real servers, sockets and simulated devices.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
