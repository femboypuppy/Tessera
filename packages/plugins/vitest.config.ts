import { fileURLToPath } from 'node:url';
import { defineProject } from 'vitest/config';

const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * The plugin host's tests, plus the tests of the example plugins and the plugin template
 * (`examples/`), which are not workspace packages: they import the SDK by its published name, so
 * it resolves to the workspace source here.
 */
export default defineProject({
  resolve: {
    alias: [
      {
        find: /^@tessera\/plugin-api\/testing$/,
        replacement: path('../plugin-api/src/testing/index.ts'),
      },
      { find: /^@tessera\/plugin-api$/, replacement: path('../plugin-api/src/index.ts') },
      { find: /^mermaid$/, replacement: path('node_modules/mermaid') },
    ],
  },
  test: {
    name: 'plugins',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
    include: [
      'src/**/*.test.{ts,tsx}',
      '../../examples/plugins/*/src/**/*.test.ts',
      '../../examples/plugin-template/src/**/*.test.ts',
    ],
  },
});
