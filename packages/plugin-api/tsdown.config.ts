import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/testing/index.ts', 'src/query.ts', 'src/settings.ts'],
  format: 'esm',
  platform: 'neutral',
  sourcemap: true,
  clean: true,
  dts: false,
});
