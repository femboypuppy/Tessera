import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  // Emit dist/index.js: the `bin` entry points at it.
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: false,
  // A published CLI can't depend on workspace packages, so bundle them.
  noExternal: [/^@tessera\//],
});
