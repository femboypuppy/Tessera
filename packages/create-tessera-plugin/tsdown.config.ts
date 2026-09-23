import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/cli.ts', 'src/index.ts'],
  format: 'esm',
  platform: 'node',
  // Emit dist/cli.js: the `bin` entry points at it.
  fixedExtension: false,
  sourcemap: true,
  clean: true,
  dts: false,
});
