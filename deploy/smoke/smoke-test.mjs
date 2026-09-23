#!/usr/bin/env node
/**
 * Container smoke test: starts the image the way docker-compose.yml does (read-only root, no
 * capabilities, a named volume), waits until Docker reports it healthy, creates the owner,
 * syncs a document, restarts the container and checks that the document is still there.
 *
 *   node deploy/smoke/smoke-test.mjs --build            # build the image from this checkout first
 *   node deploy/smoke/smoke-test.mjs --image tessera:dev
 *   node deploy/smoke/smoke-test.mjs --allow-stub       # see "The server stub" below
 *
 * Exit code 0 when every step passed.
 *
 * What it expects from the server (apps/server, Agent 03), as specified in agents/03-sync.md:
 * - `GET /api/health` answers 200 `{ ok: true }` (the Docker HEALTHCHECK uses it too);
 * - `GET /` serves the web app;
 * - the owner is created with `tessera-server create-owner --email E --password P --name N`
 *   (falling back to `POST /api/setup { email, password, name }`, the first-run form);
 * - `POST /api/auth/login { email, password, client: "desktop" }` returns `{ token }`;
 * - `POST /api/workspaces { name }` returns `{ id }` (or `{ workspace: { id } }`);
 * - Hocuspocus listens on `ws(s)://<server>/sync` (SMOKE_SYNC_PATH) and authenticates with the
 *   bearer token; documents are named `ws:<workspaceId>` (SMOKE_DOC_NAME, `{id}` placeholder).
 * If the merged server differs, adjust the `server` object below: every assumption is there.
 *
 * The server stub: until Agent 03's server is merged, apps/server only answers /api/health. The
 * script detects that. By default it then fails; with `--allow-stub` it still checks everything
 * the image itself is responsible for (health, non-root user, writable /data surviving a
 * restart, graceful stop) and reports the owner and sync steps as skipped.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const image = option('--image', 'tessera:smoke');
const port = Number(option('--port', '18787'));
const suffix = randomBytes(4).toString('hex');
const container = `tessera-smoke-${suffix}`;
const volume = `tessera-smoke-${suffix}`;
const base = `http://127.0.0.1:${port}`;
const owner = {
  email: 'owner@smoke.test',
  password: `smoke-${randomBytes(12).toString('hex')}`,
  name: 'Smoke Owner',
};

const server = {
  syncPath: process.env.SMOKE_SYNC_PATH ?? '/sync',
  docName: (workspaceId) => (process.env.SMOKE_DOC_NAME ?? 'ws:{id}').replace('{id}', workspaceId),
  createOwnerCli: [
    'tessera-server',
    'create-owner',
    '--email',
    owner.email,
    '--password',
    owner.password,
    '--name',
    owner.name,
  ],
  async createOwnerHttp() {
    return fetch(`${base}/api/setup`, json({ ...owner }));
  },
  async signIn() {
    const response = await fetch(
      `${base}/api/auth/login`,
      json({ email: owner.email, password: owner.password, client: 'desktop' }),
    );
    if (!response.ok) throw new Error(`POST /api/auth/login answered ${response.status}`);
    const body = await response.json();
    const token = body.token ?? body.accessToken;
    if (typeof token !== 'string') throw new Error('POST /api/auth/login returned no token');
    return token;
  },
  async createWorkspace(token) {
    const response = await fetch(`${base}/api/workspaces`, json({ name: 'Smoke test' }, token));
    if (!response.ok) throw new Error(`POST /api/workspaces answered ${response.status}`);
    const body = await response.json();
    const id = body.id ?? body.workspace?.id;
    if (typeof id !== 'string') throw new Error('POST /api/workspaces returned no id');
    return id;
  },
};

function json(body, token) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  return { method: 'POST', headers, body: JSON.stringify(body) };
}

function docker(...commandArgs) {
  return execFileSync('docker', commandArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function dockerStatus(...commandArgs) {
  return spawnSync('docker', commandArgs, { encoding: 'utf8' });
}

async function step(name, action) {
  process.stdout.write(`- ${name}… `);
  const started = Date.now();
  try {
    const result = await action();
    console.info(`ok (${Date.now() - started} ms)`);
    return result;
  } catch (error) {
    console.info('FAILED');
    throw error;
  }
}

const skipped = [];
function skip(name, reason) {
  console.info(`- ${name}… SKIPPED (${reason})`);
  skipped.push(name);
}

async function waitHealthy(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = JSON.parse(docker('inspect', '--format', '{{json .State}}', container));
    if (!state.Running) throw new Error(`the container stopped (exit ${state.ExitCode})`);
    const health = state.Health?.Status;
    if (health === 'healthy') return;
    if (health === 'unhealthy') throw new Error('Docker reports the container unhealthy');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('the container was not healthy in time');
}

/** A Hocuspocus client from @tessera/sync's dependencies (the same one the app uses). */
function syncClient() {
  const require = createRequire(path.join(repo, 'packages', 'sync', 'package.json'));
  const Y = require('yjs');
  const { HocuspocusProvider } = require('@hocuspocus/provider');
  return { Y, HocuspocusProvider };
}

async function withDoc(token, name, use) {
  const { Y, HocuspocusProvider } = syncClient();
  const doc = new Y.Doc();
  const url = `ws://127.0.0.1:${port}${server.syncPath}`;
  const provider = new HocuspocusProvider({ url, name, document: doc, token });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no sync with ${url} (${name})`)), 20_000);
      provider.on('synced', () => {
        clearTimeout(timer);
        resolve();
      });
      provider.on('authenticationFailed', ({ reason }) => {
        clearTimeout(timer);
        reject(new Error(`authentication failed: ${reason}`));
      });
    });
    const result = await use(doc);
    const deadline = Date.now() + 10_000;
    while (provider.hasUnsyncedChanges && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (provider.hasUnsyncedChanges) throw new Error('changes were not acknowledged by the server');
    return result;
  } finally {
    provider.destroy();
  }
}

let failed = false;
try {
  console.info(`Tessera container smoke test\n  image: ${image}\n  container: ${container}`);
  if (flag('--build')) {
    await step(`docker build -t ${image} .`, () => {
      execFileSync('docker', ['build', '-t', image, repo], {
        stdio: ['ignore', 'ignore', 'inherit'],
      });
    });
  }
  const size = Number(docker('image', 'inspect', '--format', '{{.Size}}', image));
  console.info(
    `  image size: ${(size / 1024 / 1024).toFixed(1)} MB (as docker image inspect reports it)`,
  );

  await step('start with a named volume, read-only root, no capabilities', () => {
    docker('volume', 'create', volume);
    docker(
      'run',
      '--detach',
      '--name',
      container,
      '--publish',
      `127.0.0.1:${port}:8787`,
      '--volume',
      `${volume}:/data`,
      '--read-only',
      '--tmpfs',
      '/tmp',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '--env',
      `PUBLIC_URL=${base}`,
      image,
    );
  });
  await step('Docker reports it healthy', () => waitHealthy());
  await step('runs as a non-root user', () => {
    const uid = docker('exec', container, 'id', '-u');
    if (uid === '0') throw new Error('the server runs as root');
  });
  const health = await step('GET /api/health', async () => {
    const response = await fetch(`${base}/api/health`);
    if (!response.ok) throw new Error(`status ${response.status}`);
    return response.json();
  });
  if (health.ok !== true) throw new Error(`unexpected health ${JSON.stringify(health)}`);

  const probe = await fetch(`${base}/api/auth/login`, json({})).catch(() => null);
  const isStub = !probe || probe.status === 404;
  if (isStub) console.info('  the server is the stub (no /api/auth yet): see --allow-stub');

  let marker = `smoke-${randomBytes(8).toString('hex')}`;
  let token = null;
  let docName = null;
  if (!isStub) {
    await step('serves the web app at /', async () => {
      const html = await (await fetch(`${base}/`)).text();
      if (!html.includes('id="root"')) throw new Error('GET / is not the web app');
    });
    await step('create the owner', async () => {
      const cli = dockerStatus('exec', container, ...server.createOwnerCli);
      if (cli.status === 0) return;
      const response = await server.createOwnerHttp();
      if (!response.ok)
        throw new Error(
          `create-owner failed (${cli.stderr.trim()}) and POST /api/setup answered ${response.status}`,
        );
    });
    token = await step('sign in as the owner', () => server.signIn());
    const workspaceId = await step('create a workspace', () => server.createWorkspace(token));
    docName = server.docName(workspaceId);
    await step(`sync a document (${docName})`, () =>
      withDoc(token, docName, (doc) => doc.getMap('smoke').set('marker', marker)),
    );
  } else {
    skip('serve the web app, create the owner, sign in, sync a document', 'server stub');
    await step('write a marker into /data', () => {
      docker('exec', container, 'sh', '-c', `echo ${marker} > /data/.smoke-marker`);
    });
  }

  await step('restart (graceful stop within the grace period)', async () => {
    const started = Date.now();
    docker('restart', '--time', '20', container);
    if (Date.now() - started > 19_000) throw new Error('the server did not stop on SIGTERM');
    await waitHealthy();
  });

  if (!isStub && token && docName) {
    token = await step('sign in again', () => server.signIn());
    await step('the document survived the restart', () =>
      withDoc(token, docName, (doc) => {
        const value = doc.getMap('smoke').get('marker');
        if (value !== marker) throw new Error(`expected ${marker}, found ${String(value)}`);
      }),
    );
  } else {
    await step('the data in /data survived the restart', () => {
      const value = docker('exec', container, 'cat', '/data/.smoke-marker');
      if (value !== marker) throw new Error(`expected ${marker}, found ${value}`);
      docker('exec', container, 'rm', '/data/.smoke-marker');
    });
    marker = '';
  }

  if (isStub && !flag('--allow-stub')) {
    throw new Error(
      'the image works, but the server is the stub: the owner and sync steps could not run',
    );
  }
  console.info(skipped.length ? `\nPASS with skipped steps: ${skipped.join('; ')}` : '\nPASS');
} catch (error) {
  failed = true;
  console.error(`\nFAIL: ${error instanceof Error ? error.message : String(error)}`);
  const logs = dockerStatus('logs', '--tail', '50', container);
  if (logs.stdout || logs.stderr) console.error(`\nContainer logs:\n${logs.stdout}${logs.stderr}`);
} finally {
  if (!flag('--keep')) {
    dockerStatus('rm', '--force', container);
    dockerStatus('volume', 'rm', '--force', volume);
  }
}
process.exit(failed ? 1 : 0);
