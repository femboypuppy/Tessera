import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'desktop',
    environment: 'jsdom',
    setupFiles: ['@tessera/core/testing/setup-dom'],
    // The first test of a file that loads the whole desktop feature pays for transforming it
    // (lucide-react, the core runtime): several seconds on a cold cache, milliseconds after.
    testTimeout: 20_000,
    // Rust side: `pnpm test:rust` (cargo test in src-tauri).
    exclude: ['**/node_modules/**', 'src-tauri/**'],
  },
});
