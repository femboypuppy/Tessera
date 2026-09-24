import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const file = (name: string) => fileURLToPath(new URL(name, import.meta.url));

/**
 * Builds the plugin into one ES module, `dist/main.js`, next to a copy of its manifest and README:
 * the folder Tessera installs (zip it, or point Tessera at it).
 */
export default defineConfig({
  build: {
    lib: { entry: file('src/main.ts'), formats: ['es'], fileName: () => 'main.js' },
    target: 'es2022',
    outDir: file('dist'),
    emptyOutDir: true,
    // Plugins load from a single file, so lazy imports are bundled in. Library builds keep
    // whitespace in ES output, so the output minifier is on explicitly.
    rolldownOptions: { output: { codeSplitting: false, minify: true } },
  },
  plugins: [
    {
      name: 'tessera-plugin-files',
      generateBundle() {
        for (const fileName of ['manifest.json', 'README.md']) {
          if (existsSync(file(fileName)))
            this.emitFile({
              type: 'asset',
              fileName,
              source: readFileSync(file(fileName), 'utf8'),
            });
        }
      },
    },
  ],
});
