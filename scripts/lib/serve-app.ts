/**
 * The production web app for scripts that drive it in a browser (the demo recording, the memory
 * soak): `url` when one is given, otherwise `apps/web` built and served with `vite preview` on a
 * free port.
 */
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { freePort } from '../../packages/testkit/src/playwright/sync-server';

const root = path.resolve(import.meta.dirname, '..', '..');
const shell = process.platform === 'win32';

export interface ServedApp {
  url: string;
  stop(): void;
}

export async function serveApp(url?: string): Promise<ServedApp> {
  if (url) return { url, stop: () => undefined };
  console.info('Building the web app…');
  execFileSync('pnpm', ['--filter', '@tessera/web', 'build'], {
    cwd: root,
    stdio: 'inherit',
    shell,
  });
  const port = await freePort();
  const preview = spawn(
    'pnpm',
    ['--filter', '@tessera/web', 'exec', 'vite', 'preview', '--port', String(port), '--strictPort'],
    { cwd: root, stdio: 'ignore', shell },
  );
  const served = `http://localhost:${port}`;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(served)).ok) return { url: served, stop: () => preview.kill() };
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  preview.kill();
  throw new Error(`vite preview did not answer at ${served}`);
}
