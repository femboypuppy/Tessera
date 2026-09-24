import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));
const web = fileURLToPath(new URL('../../../apps/web/', import.meta.url));

/**
 * The seeded harness (`pnpm --filter @tessera/testkit harness`, or `harness:build` then
 * `harness:preview`). The same plugins and dedupe list as `apps/web/vite.config.ts`, so it builds
 * the app the same way. `HARNESS_CACHE_DIR` gives parallel dev servers separate dependency caches.
 */
export default defineConfig({
  root: here,
  publicDir: `${web}public`,
  cacheDir:
    process.env.HARNESS_CACHE_DIR ??
    fileURLToPath(new URL('../node_modules/.vite-harness', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'yjs',
      'y-protocols',
      'y-prosemirror',
      'prosemirror-model',
      'prosemirror-state',
      'prosemirror-transform',
      'prosemirror-view',
    ],
  },
  server: {
    port: 4190,
    // Transform the app's modules when the dev server starts (the worker fixture waits for that),
    // not during a test's first page load.
    warmup: { clientFiles: ['./main.tsx'] },
  },
  preview: { port: 4191 },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
