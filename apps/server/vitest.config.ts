import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'server',
    environment: 'node',
    // These tests start real servers, sockets, child processes and simulated devices.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Run after the other projects: this load must not slow down their timing-sensitive tests.
    sequence: { groupOrder: 2 },
  },
});
