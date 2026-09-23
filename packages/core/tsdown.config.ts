import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/react/index.ts', 'src/testing/index.ts'],
  format: 'esm',
  platform: 'neutral',
  sourcemap: true,
  clean: true,
  dts: false,
});
