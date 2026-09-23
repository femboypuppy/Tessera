import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'importers',
    // Importers run in Node (as in a worker); UI tests opt into jsdom with a docblock.
    environment: 'node',
  },
});
