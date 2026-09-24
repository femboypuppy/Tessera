import {
  credentialKey,
  MemoryCredentialStore,
  type CredentialStore,
  type PlatformInfo,
  type SavedCredential,
} from '@tessera/core';
import { defaultIndexedDb, requestToPromise, transactionDone } from '../idb/idb';
import { CREDENTIALS, openRegistryDatabase } from '../stores/workspace-registry';
import { ServerApi, type AuthMode } from './api';

/**
 * Where the desktop app keeps bearer tokens, per server: core's `credentialStore` service (the OS
 * keychain on the desktop, this IndexedDB store otherwise). The web app never sees a token: its
 * session is an httpOnly cookie.
 */
export type { CredentialStore };

/** Tokens in the device's IndexedDB registry database, keyed by server origin. */
export class IndexedDbCredentialStore implements CredentialStore {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory | null = defaultIndexedDb()) {}

  async get(server: string): Promise<string | null> {
    const db = await this.open();
    const record: unknown = await requestToPromise(
      db.transaction(CREDENTIALS, 'readonly').objectStore(CREDENTIALS).get(credentialKey(server)),
    );
    const token = (record as { token?: unknown } | undefined)?.token;
    return typeof token === 'string' ? token : null;
  }

  async set(server: string, token: string): Promise<void> {
    await this.write((store) =>
      store.put({ serverUrl: credentialKey(server), token, savedAt: Date.now() }),
    );
  }

  async delete(server: string): Promise<void> {
    await this.write((store) => store.delete(credentialKey(server)));
  }

  async list(): Promise<SavedCredential[]> {
    const db = await this.open();
    const records: unknown = await requestToPromise(
      db.transaction(CREDENTIALS, 'readonly').objectStore(CREDENTIALS).getAll(),
    );
    return (Array.isArray(records) ? records : [])
      .flatMap((record: unknown) => {
        const { serverUrl, savedAt } = (record ?? {}) as { serverUrl?: unknown; savedAt?: unknown };
        return typeof serverUrl === 'string'
          ? [{ server: serverUrl, savedAt: typeof savedAt === 'number' ? savedAt : 0 }]
          : [];
      })
      .sort((a, b) => b.savedAt - a.savedAt);
  }

  private async write(change: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(CREDENTIALS, 'readwrite');
    const done = transactionDone(transaction);
    change(transaction.objectStore(CREDENTIALS));
    await done;
  }

  private open(): Promise<IDBDatabase> {
    if (!this.factory) return Promise.reject(new Error('IndexedDB is not available'));
    this.db ??= openRegistryDatabase(this.factory);
    return this.db;
  }
}

let credentials: CredentialStore | null = null;

/**
 * Sets the credential store the API clients and the sync provider use: the session's resolved
 * `credentialStore` service (the sync feature calls this when a workspace opens). Existing API
 * clients keep the store they were created with, so changing it drops them.
 */
export function setCredentialStore(store: CredentialStore): void {
  if (credentials === store) return;
  credentials = store;
  apis.clear();
}

/** The current credential store (IndexedDB, or memory without it, until one is set). */
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
      setToken: (token) => (token ? store.set(serverUrl, token) : store.delete(serverUrl)),
    });
    apis.set(key, api);
  }
  return api;
}
