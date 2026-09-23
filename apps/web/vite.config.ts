import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Packages ship TypeScript source; Vite compiles them like app code. Yjs and ProseMirror must be
// single instances (duplicate copies break `instanceof` checks and Yjs warns), hence `dedupe`.
export default defineConfig({
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
  server: { port: 5173 },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The budget (SPEC.md) is 250 KB gzip for the startup JS. At the usual ~3.2:1 ratio that is
    // about 750 KB minified, so the warning fires when the shell chunk nears the budget.
    chunkSizeWarningLimit: 750,
  },
});
