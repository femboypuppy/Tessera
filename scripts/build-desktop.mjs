#!/usr/bin/env node
/**
 * The last step of `pnpm build`: the desktop app (`apps/desktop`, Tauri), after `pnpm -r build`
 * built the web app it embeds. The executable lands in `apps/desktop/src-tauri/target/release/`;
 * installers come from `pnpm --filter @tessera/desktop build:app` (and CI's desktop workflow).
 *
 * Skipped, with a note, when `TESSERA_SKIP_DESKTOP=1` (CI's build job: the desktop workflow
 * builds and signs the app on each OS) or when the Rust toolchain isn't installed.
 */
import { spawnSync } from 'node:child_process';

const note = (message) => console.info(`\n[build] ${message}\n`);

if (process.env.TESSERA_SKIP_DESKTOP === '1') {
  note('Desktop app skipped (TESSERA_SKIP_DESKTOP=1).');
  process.exit(0);
}
const cargo = spawnSync('cargo', ['--version'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
if (cargo.status !== 0) {
  note(
    'Desktop app skipped: Rust is not installed. Install it (https://rustup.rs) and the Tauri ' +
      'prerequisites (https://tauri.app/start/prerequisites/), then run `pnpm build` again.',
  );
  process.exit(0);
}
// The web app is already built, so `tauri.prebuilt.conf.json` turns off Tauri's own
// `beforeBuildCommand` (a second web build).
const result = spawnSync(
  'pnpm',
  [
    '--filter',
    '@tessera/desktop',
    'exec',
    'tauri',
    'build',
    '--no-bundle',
    '--config',
    'src-tauri/tauri.prebuilt.conf.json',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
