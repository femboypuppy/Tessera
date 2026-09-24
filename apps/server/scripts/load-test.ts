/**
 * Load test: N clients editing shared docs through the real sync server.
 *
 *   pnpm --filter @tessera/server load-test                       # 50 clients, 30 s
 *   pnpm --filter @tessera/server load-test -- --clients 100 --seconds 60 --docs 10 --rate 4
 *
 * By default it starts the server from source as its own process (a fresh DATA_DIR), creates an
 * owner and a workspace, and connects every client over its own WebSocket with a bearer token.
 * Each client types into one of `--docs` shared pages (`--rate` edits per second, at random
 * positions) and moves its presence. It measures how long an edit takes to reach the other
 * clients on the same page, then stops editing, waits until everything is acknowledged, and
 * checks that every client and a fresh reader of the server hold the same content.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { HocuspocusProvider } from '@hocuspocus/provider';
import { SyncSocket } from '@tessera/sync/socket';
import WebSocket from 'ws';
import * as Y from 'yjs';

const { values: args } = parseArgs({
  // pnpm passes the `--` separator through to the script.
  args: process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--')),
  options: {
    clients: { type: 'string', default: '50' },
    seconds: { type: 'string', default: '30' },
    docs: { type: 'string', default: '5' },
    rate: { type: 'string', default: '4' },
  },
});
const CLIENTS = Number(args.clients);
const SECONDS = Number(args.seconds);
const DOCS = Number(args.docs);
const RATE = Number(args.rate);
const SETUP_CODE = 'LOAD-TEST-CODE';

class NodeWebSocket extends WebSocket {
  constructor(address: string, protocols?: string | string[]) {
    super(address, protocols);
    this.on('error', () => undefined);
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? NaN;
}

async function waitFor(check: () => boolean, timeoutMs: number, label: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function main(): Promise<void> {
  const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tessera-load-'));
  const port = await freePort();
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: serverRoot,
    env: {
      ...process.env,
      DATA_DIR: dataDir,
      PORT: String(port),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      SETUP_CODE,
      WEB_DIR: path.join(dataDir, 'no-web'),
      NODE_ENV: 'production',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    const started = Date.now();
    for (;;) {
      try {
        if ((await fetch(`${base}/api/health`)).ok) break;
      } catch {
        // Starting.
      }
      if (Date.now() - started > 60_000) throw new Error('The server did not start');
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const setup = (await (
      await fetch(`${base}/api/auth/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          setupCode: SETUP_CODE,
          name: 'Load test',
          email: 'load@example.com',
          password: 'load test password',
          client: 'desktop',
        }),
      })
    ).json()) as { token: string };
    const workspace = (await (
      await fetch(`${base}/api/workspaces`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${setup.token}` },
        body: JSON.stringify({ name: 'Load test' }),
      })
    ).json()) as { workspace: { id: string } };
    const workspaceId = workspace.workspace.id;
    const docNames = Array.from({ length: DOCS }, (_, i) => `page:load-${i}`);

    console.log(
      `Tessera load test: ${CLIENTS} clients, ${DOCS} shared pages, ${RATE} edits/s per client, ${SECONDS} s (Node ${process.version}, ${os.cpus().length} CPUs)`,
    );

    // Latency bookkeeping: when each edit was made, and when each other client on its doc saw it.
    const sentAt = new Map<string, number>();
    const latencies: number[] = [];
    let editsMade = 0;
    let errors = 0;

    interface Client {
      id: number;
      docName: string;
      doc: Y.Doc;
      socket: SyncSocket;
      provider: HocuspocusProvider;
    }
    const clients: Client[] = [];
    const connectStart = performance.now();
    for (let id = 0; id < CLIENTS; id += 1) {
      const docName = docNames[id % DOCS] ?? 'page:load-0';
      const doc = new Y.Doc();
      const socket = new SyncSocket({
        url: `ws://127.0.0.1:${port}/sync`,
        WebSocketPolyfill: NodeWebSocket,
      });
      const provider = new HocuspocusProvider({
        name: `${workspaceId}/${docName}`,
        document: doc,
        token: setup.token,
        websocketProvider: socket,
        onAuthenticationFailed: () => {
          errors += 1;
        },
      });
      provider.attach();
      provider.setAwarenessField('user', {
        id: `client-${id}`,
        name: `Client ${id}`,
        color: '#0090ff',
      });
      doc.getText('t').observe((event) => {
        if (event.transaction.origin !== provider) return;
        const now = performance.now();
        for (const change of event.delta) {
          if (typeof change.insert !== 'string') continue;
          for (const marker of change.insert.matchAll(/\[(c\d+-\d+)\]/g)) {
            const at = marker[1] ? sentAt.get(marker[1]) : undefined;
            if (at !== undefined) latencies.push(now - at);
          }
        }
      });
      clients.push({ id, docName, doc, socket, provider });
    }
    await waitFor(
      () => clients.every((client) => client.provider.isSynced),
      60_000,
      'all clients to sync',
    );
    const connectMs = performance.now() - connectStart;
    console.log(`Connected and synced ${CLIENTS} clients in ${Math.round(connectMs)} ms`);

    // Edit.
    const cpuBefore = process.cpuUsage();
    const editStart = performance.now();
    const timers = clients.map((client) => {
      let n = 0;
      return setInterval(() => {
        const text = client.doc.getText('t');
        const marker = `c${client.id}-${n}`;
        n += 1;
        sentAt.set(marker, performance.now());
        text.insert(Math.floor(Math.random() * (text.length + 1)), `[${marker}]`);
        if (n % 5 === 0) client.provider.setAwarenessField('cursor', { anchor: n, head: n });
        editsMade += 1;
      }, 1000 / RATE);
    });
    await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));
    for (const timer of timers) clearInterval(timer);
    const editMs = performance.now() - editStart;

    // Settle: every edit acknowledged, then compare.
    const settleStart = performance.now();
    await waitFor(
      () =>
        clients.every((client) => client.provider.isSynced && !client.provider.hasUnsyncedChanges),
      120_000,
      'every edit to be acknowledged',
    );
    for (const docName of docNames) {
      const group = clients.filter((client) => client.docName === docName);
      await waitFor(
        () =>
          group.every(
            (client) =>
              client.doc.getText('t').toString() === group[0]?.doc.getText('t').toString(),
          ),
        60_000,
        `clients of ${docName} to converge`,
      );
    }
    const settleMs = performance.now() - settleStart;

    // A fresh reader gets the server's copy.
    let serverMatches = 0;
    for (const docName of docNames) {
      const reader = new Y.Doc();
      const socket = new SyncSocket({
        url: `ws://127.0.0.1:${port}/sync`,
        WebSocketPolyfill: NodeWebSocket,
      });
      const provider = new HocuspocusProvider({
        name: `${workspaceId}/${docName}`,
        document: reader,
        token: setup.token,
        websocketProvider: socket,
      });
      provider.attach();
      await waitFor(() => provider.isSynced, 30_000, `a reader of ${docName}`);
      const expected = clients
        .find((client) => client.docName === docName)
        ?.doc.getText('t')
        .toString();
      if (reader.getText('t').toString() === expected) serverMatches += 1;
      provider.destroy();
      socket.destroy();
    }

    const cpu = process.cpuUsage(cpuBefore);
    const sorted = [...latencies].sort((a, b) => a - b);
    const receiversPerEdit = CLIENTS / DOCS - 1;
    const expectedDeliveries = editsMade * receiversPerEdit;
    const dbSize = statSync(path.join(dataDir, 'tessera.db')).size;
    const lines = [
      '| Measure | Result |',
      '|---|---|',
      `| Clients / shared pages | ${CLIENTS} / ${DOCS} (${CLIENTS / DOCS} per page) |`,
      `| Edits made | ${editsMade} in ${(editMs / 1000).toFixed(1)} s (${Math.round(editsMade / (editMs / 1000))}/s) |`,
      `| Deliveries measured | ${latencies.length} of ${expectedDeliveries} expected |`,
      `| Propagation latency p50 / p95 / p99 / max | ${percentile(sorted, 50).toFixed(1)} / ${percentile(sorted, 95).toFixed(1)} / ${percentile(sorted, 99).toFixed(1)} / ${(sorted.at(-1) ?? NaN).toFixed(1)} ms |`,
      `| Time to acknowledge everything after the last edit | ${Math.round(settleMs)} ms |`,
      `| Pages identical on every client | ${docNames.length} of ${docNames.length} |`,
      `| Pages identical on the server (fresh reader) | ${serverMatches} of ${docNames.length} |`,
      `| Authentication errors | ${errors} |`,
      `| Database size after the run | ${(dbSize / 1024 / 1024).toFixed(2)} MB |`,
      `| Load generator CPU (user + system) | ${((cpu.user + cpu.system) / 1e6).toFixed(1)} s |`,
    ];
    console.log(`\n${lines.join('\n')}\n`);
    const ok =
      serverMatches === docNames.length && errors === 0 && latencies.length === expectedDeliveries;
    for (const client of clients) {
      client.provider.destroy();
      client.socket.destroy();
    }
    if (!ok) {
      console.error('The load test found a problem (see the table).');
      process.exitCode = 1;
    }
  } finally {
    server.kill();
    await new Promise((resolve) => server.once('exit', resolve));
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
