import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/main.ts'],
  format: 'esm',
  platform: 'node',
  // Emit dist/main.js (not .mjs): package.json declares "type": "module" and "start" runs dist/main.js.
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: false,
  // Workspace packages ship TypeScript source, so bundle them; npm dependencies stay external.
  noExternal: [/^@tessera\//],
});
