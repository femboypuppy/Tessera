import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import pino from 'pino';
import WebSocket from 'ws';
import * as Y from 'yjs';
import type { ServerConfig } from '../config';
import { startServer, type StartServerOptions, type TesseraServer } from '../server';

export const SETUP_CODE = 'TEST-SETUP-CODE';

/** A test clock that tests can move forward. */
export function testClock(start = Date.UTC(2026, 0, 1)) {
  let now = start;
  return {
    now: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

export interface TestServer {
  server: TesseraServer;
  url: string;
  wsUrl: string;
  dataDir: string;
  api: ApiClient;
  /** Stops the server (idempotent). The data folder stays until `cleanup`. */
  stop(): Promise<void>;
  /** Starts a new server on the same data folder (a restart). */
  restart(): Promise<TestServer>;
  cleanup(): Promise<void>;
}

export function testConfig(dataDir: string, overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    host: '127.0.0.1',
    dataDir,
    publicUrl: null,
    maxUploadBytes: 1024 * 1024,
    signupMode: 'open',
    logLevel: 'silent',
    corsOrigins: ['http://localhost:5173'],
    trustProxy: false,
    webDir: path.join(dataDir, 'no-web-build'),
    sessionDays: 30,
    setupCode: SETUP_CODE,
    ...overrides,
  };
}

/** Starts a server on a random port with a fresh data folder, cheap hashing and no logs. */
export async function startTestServer(
  overrides: Partial<ServerConfig> = {},
  options: Partial<StartServerOptions> = {},
  existingDataDir?: string,
): Promise<TestServer> {
  const dataDir = existingDataDir ?? mkdtempSync(path.join(os.tmpdir(), 'tessera-server-'));
  const server = await startServer({
    config: testConfig(dataDir, overrides),
    logger: pino({ level: 'silent' }),
    hashing: { memoryCost: 1024, timeCost: 1, parallelism: 1 },
    maintenanceIntervalMs: 0,
    ...options,
  });
  const url = `http://127.0.0.1:${server.port}`;
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await server.close();
  };
  const self: TestServer = {
    server,
    url,
    wsUrl: `ws://127.0.0.1:${server.port}/sync`,
    dataDir,
    api: createApiClient(url),
    stop,
    restart: async () => {
      await stop();
      return startTestServer(overrides, options, dataDir);
    },
    cleanup: async () => {
      await stop();
      rmSync(dataDir, { recursive: true, force: true });
    },
  };
  return self;
}

/**
 * Stops every server, then removes their data folders (restarted servers share a folder, and
 * Windows can't delete a folder whose database is still open).
 */
export async function cleanupServers(servers: TestServer[]): Promise<void> {
  const list = servers.splice(0);
  for (const t of list) await t.stop();
  for (const t of list) await t.cleanup();
}

export interface ApiResponse<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
}

export interface RequestOptions {
  body?: unknown;
  raw?: BodyInit;
  token?: string;
  cookie?: string;
  origin?: string;
  headers?: Record<string, string>;
}

export type ApiClient = <T = Record<string, unknown>>(
  method: string,
  path: string,
  options?: RequestOptions,
) => Promise<ApiResponse<T>>;

export function createApiClient(baseUrl: string): ApiClient {
  return async (method, requestPath, options = {}) => {
    const headers = new Headers(options.headers);
    if (options.body !== undefined) headers.set('content-type', 'application/json');
    if (options.token) headers.set('authorization', `Bearer ${options.token}`);
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.origin) headers.set('origin', options.origin);
    const response = await fetch(`${baseUrl}${requestPath}`, {
      method,
      headers,
      body: options.raw ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
      ...(options.raw instanceof ReadableStream ? { duplex: 'half' } : {}),
    } as RequestInit);
    const text = await response.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON.
    }
    return { status: response.status, body: body as never, headers: response.headers };
  };
}

/** The owner account plus one workspace, with bearer tokens. */
export async function bootstrap(t: TestServer, workspaceName = 'Apollo') {
  const setup = await t.api<{ token: string; user: { id: string } }>('POST', '/api/auth/setup', {
    body: {
      setupCode: SETUP_CODE,
      name: 'Ada Owner',
      email: 'ada@example.com',
      password: 'correct horse battery',
      client: 'desktop',
    },
  });
  if (setup.status !== 201) throw new Error(`setup failed: ${JSON.stringify(setup.body)}`);
  const created = await t.api<{ workspace: { id: string } }>('POST', '/api/workspaces', {
    token: setup.body.token,
    body: { name: workspaceName },
  });
  if (created.status !== 201) throw new Error(`workspace failed: ${JSON.stringify(created.body)}`);
  return {
    ownerToken: setup.body.token,
    ownerId: setup.body.user.id,
    workspaceId: created.body.workspace.id,
  };
}

/** Signs up another account (open mode) and returns its bearer token and ID. */
export async function signUp(t: TestServer, email: string, name = email.split('@')[0] ?? email) {
  const response = await t.api<{ token: string; user: { id: string } }>(
    'POST',
    '/api/auth/signup',
    {
      body: { name, email, password: 'another good password', client: 'desktop' },
    },
  );
  if (response.status !== 201) throw new Error(`signup failed: ${JSON.stringify(response.body)}`);
  return { token: response.body.token, userId: response.body.user.id };
}

/** Adds a member with a role through an invite. */
export async function addMember(
  t: TestServer,
  ownerToken: string,
  workspaceId: string,
  email: string,
  role: 'editor' | 'viewer',
) {
  const account = await signUp(t, email);
  const invite = await t.api<{ token: string }>('POST', `/api/workspaces/${workspaceId}/invites`, {
    token: ownerToken,
    body: { role },
  });
  const accepted = await t.api('POST', `/api/invites/${invite.body.token}/accept`, {
    token: account.token,
  });
  if (accepted.status !== 200) throw new Error(`accept failed: ${JSON.stringify(accepted.body)}`);
  return account;
}

/** A Node sync client for one doc (Hocuspocus provider over `ws`). */
export interface SyncClient {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  socket: HocuspocusProviderWebsocket;
  authFailure: Promise<string>;
  synced(): Promise<void>;
  /** Resolves when every local change was acknowledged by the server. */
  settled(timeoutMs?: number): Promise<void>;
  destroy(): void;
}

export function connectClient(
  wsUrl: string,
  name: string,
  token: string,
  options: { doc?: Y.Doc; socket?: HocuspocusProviderWebsocket } = {},
): SyncClient {
  const doc = options.doc ?? new Y.Doc();
  const socket =
    options.socket ??
    new HocuspocusProviderWebsocket({
      url: wsUrl,
      WebSocketPolyfill: WebSocket,
      delay: 50,
      minDelay: 50,
      maxDelay: 500,
    });
  let failed: (reason: string) => void = () => undefined;
  const authFailure = new Promise<string>((resolve) => {
    failed = resolve;
  });
  const provider = new HocuspocusProvider({
    name,
    document: doc,
    token,
    websocketProvider: socket,
    onAuthenticationFailed: ({ reason }) => failed(reason),
  });
  provider.attach();
  return {
    doc,
    provider,
    socket,
    authFailure,
    synced: () =>
      provider.isSynced
        ? Promise.resolve()
        : new Promise((resolve) => provider.on('synced', () => resolve())),
    settled: async (timeoutMs = 5000) => {
      const deadline = Date.now() + timeoutMs;
      while (!provider.isSynced || provider.hasUnsyncedChanges) {
        if (Date.now() > deadline) throw new Error(`not settled: ${name}`);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    },
    destroy: () => {
      provider.destroy();
      if (!options.socket) socket.destroy();
    },
  };
}

/** Waits until `check` passes (polling), or throws after `timeoutMs`. */
export async function eventually(
  check: () => void | Promise<void>,
  timeoutMs = 5000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('eventually: timed out');
}
