/**
 * Starts the Tessera server (`apps/server`) for tests: a real process on a free port, with its
 * data in a temporary folder that is deleted afterwards. Configuration uses the server's
 * environment variables (PORT, HOST, DATA_DIR, PUBLIC_URL, SIGNUP_MODE, CORS_ORIGINS, WEB_DIR).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ENTRY = path.join(REPO, 'apps', 'server', 'src', 'main.ts');

export interface SyncServer {
  /** `http://localhost:<port>` */
  url: string;
  dataDir: string;
  /** Output so far, for failure messages. */
  logs(): string;
  /** Creates the owner account with the server's `create-owner` command. */
  createOwner(account: { email: string; name: string; password: string }): Promise<void>;
  stop(): Promise<void>;
}

/** A free TCP port on 127.0.0.1. */
export async function freePort(): Promise<number> {
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

function run(args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  // tsx runs the server from source, so tests never need a separate server build.
  return spawn(process.execPath, ['--import', 'tsx', ENTRY, ...args], {
    cwd: REPO,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export async function startSyncServer(
  options: { port?: number; corsOrigins?: string[]; webDir?: string; timeoutMs?: number } = {},
): Promise<SyncServer> {
  const port = options.port ?? (await freePort());
  // `localhost`, like the app under test: the same site, so the browser sends the server's
  // SameSite=Lax session cookie with the app's requests (127.0.0.1 would be another site).
  const url = `http://localhost:${port}`;
  const dataDir = mkdtempSync(path.join(tmpdir(), 'tessera-server-'));
  const webDir = options.webDir ?? path.join(REPO, 'apps', 'web', 'dist');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    // Both IPv4 and IPv6: `localhost` may resolve to either.
    HOST: '::',
    DATA_DIR: dataDir,
    PUBLIC_URL: url,
    SIGNUP_MODE: 'open',
    CORS_ORIGINS: (options.corsOrigins ?? []).join(','),
    LOG_LEVEL: 'warn',
    ...(existsSync(path.join(webDir, 'index.html')) ? { WEB_DIR: webDir } : {}),
  };
  let output = '';
  const child = run(['start'], env);
  child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  let exited = false;
  child.once('exit', () => (exited = true));

  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    if (exited) throw new Error(`The server exited before it was ready:\n${output}`);
    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) break;
    } catch {
      // Not listening yet.
    }
    if (Date.now() > deadline) {
      child.kill();
      throw new Error(`The server did not answer /api/health within the timeout:\n${output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return {
    url,
    dataDir,
    logs: () => output,
    async createOwner(account) {
      const command = run(
        ['create-owner', '--email', account.email, '--name', account.name, '--password-stdin'],
        env,
      );
      let result = '';
      command.stdout?.on('data', (chunk: Buffer) => (result += chunk.toString()));
      command.stderr?.on('data', (chunk: Buffer) => (result += chunk.toString()));
      command.stdin?.end(account.password);
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          command.kill();
          resolve(null);
        }, 30_000);
        command.once('exit', (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });
      if (code !== 0) throw new Error(`create-owner failed (${String(code)}):\n${result}`);
    },
    async stop() {
      if (!exited) {
        const gone = new Promise((resolve) => child.once('exit', resolve));
        child.kill();
        await Promise.race([gone, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      }
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
