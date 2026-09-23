import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { connectClient, createApiClient, SETUP_CODE, type SyncClient } from '../testing/harness';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const children: ChildProcess[] = [];
const clients: SyncClient[] = [];
const dirs: string[] = [];

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

/** Starts the real server entry point (`src/main.ts`) as its own process. */
async function spawnServer(dataDir: string, port: number): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      SIGNUP_MODE: 'open',
      SETUP_CODE,
      WEB_DIR: path.join(dataDir, 'no-web'),
      NODE_ENV: 'production',
    },
    stdio: 'ignore',
  });
  children.push(child);
  const deadline = Date.now() + 30_000;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.ok) return child;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) throw new Error('the server did not start');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function waitForExit(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) resolve();
    else child.once('exit', () => resolve());
  });
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await waitForExit(child);
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('crash safety', () => {
  it('keeps every acknowledged update when the server process is killed', async () => {
    const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tessera-crash-'));
    dirs.push(dataDir);
    const port = await freePort();
    const first = await spawnServer(dataDir, port);
    const api = createApiClient(`http://127.0.0.1:${port}`);
    const setup = await api<{ token: string }>('POST', '/api/auth/setup', {
      body: {
        setupCode: SETUP_CODE,
        name: 'Ada',
        email: 'ada@example.com',
        password: 'crash test password',
        client: 'desktop',
      },
    });
    const workspace = await api<{ workspace: { id: string } }>('POST', '/api/workspaces', {
      token: setup.body.token,
      body: { name: 'Crash test' },
    });
    const name = `${workspace.body.workspace.id}/page:crash`;
    const wsUrl = `ws://127.0.0.1:${port}/sync`;
    const writer = connectClient(wsUrl, name, setup.body.token);
    clients.push(writer);
    await writer.synced();
    for (const word of ['every ', 'acknowledged ', 'keystroke ', 'survives']) {
      writer.doc.getText('t').insert(writer.doc.getText('t').length, word);
    }
    await writer.settled();

    // No graceful shutdown, no final flush: the process is killed.
    first.kill('SIGKILL');
    await waitForExit(first);
    writer.destroy();

    await spawnServer(dataDir, port);
    const reader = connectClient(wsUrl, name, setup.body.token);
    clients.push(reader);
    await reader.synced();
    expect(reader.doc.getText('t').toString()).toBe('every acknowledged keystroke survives');
  }, 90_000);
});
