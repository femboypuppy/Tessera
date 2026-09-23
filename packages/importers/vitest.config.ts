import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'importers',
    environment: 'node',
  },
});
