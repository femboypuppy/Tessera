import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** The Tessera server `pnpm dev` runs next to the app (`apps/server/src/dev.ts`). */
const devServer = process.env.TESSERA_DEV_SERVER ?? 'http://localhost:8787';

/**
 * Writes `sw.js` (`service-worker.js` with this build's version and files), which caches the
 * app for offline cold starts. Builds only; the app registers it in production (`offline.ts`).
 */
function serviceWorker(): Plugin {
  const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  return {
    name: 'tessera-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle).filter(
        (file) => !file.endsWith('.map') && file !== 'index.html',
      );
      const files = [...built, ...readdirSync(here('./public'))].sort();
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync(here('./service-worker.js'), 'utf8');
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const BUILD = ${JSON.stringify({ version, files })};\n${source}`,
      });
    },
  };
}

/** The version the app reports (Settings → About, bug reports): `apps/web/package.json`. */
const version = (
  JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

// Packages ship TypeScript source; Vite compiles them like app code. Yjs and ProseMirror must be
// single instances (duplicate copies break `instanceof` checks and Yjs warns), hence `dedupe`.
export default defineConfig({
  plugins: [react(), tailwindcss(), serviceWorker()],
  define: { __TESSERA_VERSION__: JSON.stringify(version) },
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
    port: 5173,
    // The app reaches the server on its own origin, as when the server serves the app. The Host
    // header stays the app's, so the server's same-origin check accepts the requests.
    proxy: {
      '^/api/': { target: devServer },
      '^/sync(?:\\?|$)': { target: devServer, ws: true },
    },
  },
  preview: { port: 4173 },
  build: {
    target: 'es2022',
    sourcemap: true,
    // The budget (SPEC.md) is 250 KB gzip for the startup JS. At the usual ~3.2:1 ratio that is
    // about 750 KB minified, so the warning fires when the shell chunk nears the budget.
    chunkSizeWarningLimit: 750,
  },
});
