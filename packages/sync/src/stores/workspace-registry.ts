import {
  isValidId,
  newId,
  NotFoundError,
  sortWorkspaces,
  ValidationError,
  type CreateWorkspaceInput,
  type WorkspaceInfo,
  type WorkspaceRegistry,
} from '@tessera/core';
import { browserChannel, type ChannelFactory, type ChannelLike } from '../idb/channel';
import {
  defaultIndexedDb,
  deleteDatabase,
  openDatabase,
  requestToPromise,
  transactionDone,
} from '../idb/idb';
import { workspaceDatabaseName } from '../idb/schema';

/** The device-wide registry database. */
export const REGISTRY_DB_NAME = 'tessera-registry';
const REGISTRY_DB_VERSION = 1;
const WORKSPACES = 'workspaces';
/** Per-server data for this device (desktop bearer tokens), keyed by server URL. */
export const CREDENTIALS = 'credentials';

export interface IndexedDbWorkspaceRegistryOptions {
  indexedDB?: IDBFactory;
  databaseName?: string;
  channel?: ChannelFactory | null;
  now?: () => number;
  /** Maps a workspace ID to its database name (tests). */
  workspaceDatabaseName?: (workspaceId: string) => string;
}

function cleanName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (!trimmed) throw new ValidationError('Workspace names cannot be empty');
  return trimmed.slice(0, 100);
}

/** Validates a stored record (it may come from an older version or be damaged). */
function toWorkspaceInfo(value: unknown): WorkspaceInfo | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (!isValidId(record.id) || typeof record.name !== 'string' || !record.name.trim()) return null;
  const info: WorkspaceInfo = {
    id: record.id,
    name: record.name,
    createdAt: typeof record.createdAt === 'number' ? record.createdAt : 0,
  };
  if (typeof record.icon === 'string' && record.icon) info.icon = record.icon;
  if (typeof record.serverUrl === 'string' && record.serverUrl) info.serverUrl = record.serverUrl;
  if (typeof record.path === 'string' && record.path) info.path = record.path;
  if (typeof record.lastOpenedAt === 'number') info.lastOpenedAt = record.lastOpenedAt;
  return info;
}

/** Opens the registry database (shared with the credential store). */
export function openRegistryDatabase(
  factory: IDBFactory,
  name: string = REGISTRY_DB_NAME,
): Promise<IDBDatabase> {
  return openDatabase({
    factory,
    name,
    version: REGISTRY_DB_VERSION,
    upgrade: (db, oldVersion) => {
      if (oldVersion < 1) {
        db.createObjectStore(WORKSPACES, { keyPath: 'id' });
        db.createObjectStore(CREDENTIALS, { keyPath: 'serverUrl' });
      }
    },
  });
}

/**
 * {@link WorkspaceRegistry} on IndexedDB. Other tabs learn about changes over a
 * `BroadcastChannel` and notify their subscribers. `remove` also deletes the workspace's local
 * database (its docs, assets, history and sync state).
 */
export class IndexedDbWorkspaceRegistry implements WorkspaceRegistry {
  static async open(
    options: IndexedDbWorkspaceRegistryOptions = {},
  ): Promise<IndexedDbWorkspaceRegistry> {
    const factory = options.indexedDB ?? defaultIndexedDb();
    if (!factory) throw new Error('IndexedDB is not available');
    const db = await openRegistryDatabase(factory, options.databaseName);
    return new IndexedDbWorkspaceRegistry(factory, db, options);
  }

  private readonly listeners = new Set<(workspaces: WorkspaceInfo[]) => void>();
  private readonly channel: ChannelLike | null;
  private readonly clock: () => number;
  private readonly dbNameFor: (workspaceId: string) => string;
  private disposed = false;

  private constructor(
    private readonly factory: IDBFactory,
    private readonly db: IDBDatabase,
    options: IndexedDbWorkspaceRegistryOptions,
  ) {
    this.clock = options.now ?? (() => Date.now());
    this.dbNameFor = options.workspaceDatabaseName ?? workspaceDatabaseName;
    const channelFactory = options.channel === undefined ? browserChannel : options.channel;
    this.channel = channelFactory ? channelFactory('tessera:registry') : null;
    if (this.channel)
      this.channel.onmessage = () => {
        if (!this.disposed) void this.notifyLocal();
      };
  }

  async list(): Promise<WorkspaceInfo[]> {
    const transaction = this.db.transaction(WORKSPACES, 'readonly');
    const records = await requestToPromise(transaction.objectStore(WORKSPACES).getAll());
    return sortWorkspaces(
      records.map(toWorkspaceInfo).filter((ws): ws is WorkspaceInfo => ws !== null),
    );
  }

  async get(id: string): Promise<WorkspaceInfo | null> {
    if (!isValidId(id)) return null;
    const transaction = this.db.transaction(WORKSPACES, 'readonly');
    return toWorkspaceInfo(await requestToPromise(transaction.objectStore(WORKSPACES).get(id)));
  }

  async create(input: CreateWorkspaceInput): Promise<WorkspaceInfo> {
    const id = input.id ?? newId();
    if (!isValidId(id)) throw new ValidationError('Invalid workspace ID', [id]);
    const ws: WorkspaceInfo = { id, name: cleanName(input.name), createdAt: this.clock() };
    if (input.icon) ws.icon = input.icon;
    if (input.serverUrl) ws.serverUrl = input.serverUrl;
    if (input.path) ws.path = input.path;
    const transaction = this.db.transaction(WORKSPACES, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    const store = transaction.objectStore(WORKSPACES);
    // `add` fails inside the transaction when the ID exists, so two tabs can't both create it.
    const request = store.add(ws);
    request.onerror = (event) => {
      event.preventDefault();
      transaction.abort();
    };
    try {
      await done;
    } catch (error) {
      if ((error as { name?: string } | null)?.name === 'ConstraintError' || request.error)
        throw new ValidationError(`Workspace "${id}" already exists`);
      throw error;
    }
    await this.changed();
    return { ...ws };
  }

  async open(id: string): Promise<WorkspaceInfo> {
    const all = await this.list();
    const ws = all.find((candidate) => candidate.id === id);
    if (!ws) throw new NotFoundError('Workspace', id);
    // Strictly increasing, so "most recently opened" is unambiguous even within one millisecond.
    const latest = Math.max(0, ...all.map((candidate) => candidate.lastOpenedAt ?? 0));
    const next = { ...ws, lastOpenedAt: Math.max(this.clock(), latest + 1) };
    await this.write(next);
    await this.changed();
    return { ...next };
  }

  async rename(id: string, name: string): Promise<void> {
    await this.update(id, { name });
  }

  async update(
    id: string,
    patch: Partial<Pick<WorkspaceInfo, 'name' | 'icon' | 'serverUrl' | 'path'>>,
  ): Promise<WorkspaceInfo> {
    const ws = await this.get(id);
    if (!ws) throw new NotFoundError('Workspace', id);
    const next: WorkspaceInfo = { ...ws };
    if (patch.name !== undefined) next.name = cleanName(patch.name);
    if (patch.icon !== undefined) {
      if (patch.icon) next.icon = patch.icon;
      else delete next.icon;
    }
    if (patch.serverUrl !== undefined) {
      if (patch.serverUrl) next.serverUrl = patch.serverUrl;
      else delete next.serverUrl;
    }
    if (patch.path !== undefined) {
      if (patch.path) next.path = patch.path;
      else delete next.path;
    }
    await this.write(next);
    await this.changed();
    return { ...next };
  }

  async remove(id: string): Promise<void> {
    const ws = await this.get(id);
    if (!ws) throw new NotFoundError('Workspace', id);
    const transaction = this.db.transaction(WORKSPACES, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    transaction.objectStore(WORKSPACES).delete(id);
    await done;
    // Connections in other tabs close themselves on `versionchange`, so this completes.
    await deleteDatabase(this.factory, this.dbNameFor(id));
    await this.changed();
  }

  subscribe(listener: (workspaces: WorkspaceInfo[]) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    if (this.channel) {
      this.channel.onmessage = null;
      this.channel.close();
    }
    this.db.close();
  }

  private async write(ws: WorkspaceInfo): Promise<void> {
    const transaction = this.db.transaction(WORKSPACES, 'readwrite', { durability: 'strict' });
    const done = transactionDone(transaction);
    transaction.objectStore(WORKSPACES).put(ws);
    await done;
  }

  private async changed(): Promise<void> {
    try {
      this.channel?.postMessage({ v: 1, type: 'registry-changed' });
    } catch (error) {
      console.error('[sync] could not notify other tabs', error);
    }
    await this.notifyLocal();
  }

  private async notifyLocal(): Promise<void> {
    if (this.listeners.size === 0) return;
    const list = await this.list();
    for (const listener of [...this.listeners]) listener(list);
  }
}
