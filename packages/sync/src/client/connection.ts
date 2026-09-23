import type { PlatformInfo } from '@tessera/core';
import { defaultIndexedDb, requestToPromise, transactionDone } from '../idb/idb';
import { CREDENTIALS, openRegistryDatabase } from '../stores/workspace-registry';
import { ServerApi, type AuthMode } from './api';

/**
 * Where the desktop app keeps bearer tokens, per server. The web app never sees a token: its
 * session is an httpOnly cookie.
 */
export interface CredentialStore {
  get(serverUrl: string): Promise<string | null>;
  set(serverUrl: string, token: string | null): Promise<void>;
}

/** Tokens in the device's IndexedDB registry database. */
export class IndexedDbCredentialStore implements CredentialStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory | null = defaultIndexedDb()) {}

  async get(serverUrl: string): Promise<string | null> {
    const db = await this.open();
    const record: unknown = await requestToPromise(
      db.transaction(CREDENTIALS, 'readonly').objectStore(CREDENTIALS).get(serverUrl),
    );
    const token = (record as { token?: unknown } | undefined)?.token;
    return typeof token === 'string' ? token : null;
  }

  async set(serverUrl: string, token: string | null): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(CREDENTIALS, 'readwrite');
    const done = transactionDone(transaction);
    const store = transaction.objectStore(CREDENTIALS);
    if (token) store.put({ serverUrl, token });
    else store.delete(serverUrl);
    await done;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB is not available'));
    this.db ??= openRegistryDatabase(this.factory);
    return this.db;
  }
}

/** Tokens in memory (tests, and browsers without IndexedDB). */
export class MemoryCredentialStore implements CredentialStore {
  private readonly tokens = new Map<string, string>();
  async get(serverUrl: string): Promise<string | null> {
    return this.tokens.get(serverUrl) ?? null;
  }
  async set(serverUrl: string, token: string | null): Promise<void> {
    if (token) this.tokens.set(serverUrl, token);
    else this.tokens.delete(serverUrl);
  }
}

let credentials: CredentialStore | null = null;

/**
 * Replaces the credential store (the desktop app registers one backed by the OS keychain).
 * Existing API clients keep the store they were created with.
 */
export function setCredentialStore(store: CredentialStore): void {
  credentials = store;
  apis.clear();
}

export function credentialStore(): CredentialStore {
  credentials ??= defaultIndexedDb() ? new IndexedDbCredentialStore() : new MemoryCredentialStore();
  return credentials;
}

/** The desktop app authenticates with bearer tokens; the web app with its session cookie. */
export function authModeFor(platform: Pick<PlatformInfo, 'isDesktopApp'>): AuthMode {
  return platform.isDesktopApp ? 'bearer' : 'cookie';
}

const apis = new Map<string, ServerApi>();

/** The API client of a server (one per server URL and auth mode). */
export function serverApi(serverUrl: string, mode: AuthMode): ServerApi {
  const key = `${mode} ${serverUrl}`;
  let api = apis.get(key);
  if (!api) {
    const store = credentialStore();
    api = new ServerApi(serverUrl, {
      mode,
      getToken: () => store.get(serverUrl),
      setToken: (token) => store.set(serverUrl, token),
    });
    apis.set(key, api);
  }
  return api;
}
