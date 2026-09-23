// `tauri icon` also writes Android and iOS icons; Tessera ships no mobile apps (SPEC.md, non-goals).
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

for (const platform of ['android', 'ios']) {
  rmSync(fileURLToPath(new URL(`../src-tauri/icons/${platform}`, import.meta.url)), {
    recursive: true,
    force: true,
  });
}
console.info('App icons regenerated in src-tauri/icons (desktop sizes only).');
