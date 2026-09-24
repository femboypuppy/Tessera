#!/usr/bin/env node
/**
 * Builds the Linux desktop bundles (.deb, .rpm, AppImage and the bare binary) inside Docker, so
 * any machine with Docker can produce them: `pnpm --filter @tessera/desktop build:linux-docker`.
 * They land in apps/desktop/dist/linux. Cargo and pnpm caches persist between runs.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(desktop, '..', '..');
const out = path.join(desktop, 'dist', 'linux');

execFileSync(
  'docker',
  [
    'build',
    '--file',
    path.join(desktop, 'docker', 'linux-build.Dockerfile'),
    '--target',
    'artifacts',
    '--output',
    `type=local,dest=${out}`,
    repo,
  ],
  { stdio: 'inherit' },
);

console.info(`\nLinux bundles in ${out}:`);
for (const name of readdirSync(out)) {
  const size = statSync(path.join(out, name)).size / 1024 / 1024;
  console.info(`  ${name}  ${size.toFixed(1)} MB`);
}
