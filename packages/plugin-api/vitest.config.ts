import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'plugin-api',
    environment: 'node',
  },
});
