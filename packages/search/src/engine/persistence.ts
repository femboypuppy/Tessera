import type { PersistedIndex } from './index-core';

/** Where the index worker keeps persisted indexes (one entry per workspace). */
export interface IndexPersistence {
  load(key: string): Promise<PersistedIndex | null>;
  save(key: string, value: PersistedIndex): Promise<void>;
  delete(key: string): Promise<void>;
}

/** In-memory persistence (tests, and a fallback when IndexedDB is unavailable). */
export class MemoryPersistence implements IndexPersistence {
  readonly entries = new Map<string, PersistedIndex>();

  async load(key: string): Promise<PersistedIndex | null> {
    const value = this.entries.get(key);
    return value ? structuredClone(value) : null;
  }

  async save(key: string, value: PersistedIndex): Promise<void> {
    this.entries.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }
}

const DB_NAME = 'tessera-search';
const STORE = 'indexes';

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * IndexedDB persistence: database `tessera-search`, store `indexes`, keyed by workspace ID. Works
 * in workers. Failures (quota, private mode) only cost a re-index on the next start, so callers
 * log them and carry on.
 */
export class IdbPersistence implements IndexPersistence {
  private db: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB) {}

  static isAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
  }

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Cannot open the search index'));
      request.onblocked = () => reject(new Error('The search index database is blocked'));
    });
    return this.db;
  }

  async load(key: string): Promise<PersistedIndex | null> {
    const db = await this.open();
    const value: unknown = await promisify(db.transaction(STORE).objectStore(STORE).get(key));
    return isPersistedIndex(value) ? value : null;
  }

  async save(key: string, value: PersistedIndex): Promise<void> {
    const db = await this.open();
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put(value, key);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Saving the index failed'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('Saving the index aborted'));
    });
  }

  async delete(key: string): Promise<void> {
    const db = await this.open();
    await promisify(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
  }
}

/** Shape check for data read back from IndexedDB (it may come from an older version). */
export function isPersistedIndex(value: unknown): value is PersistedIndex {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.format === 'number' &&
    typeof candidate.docSchema === 'number' &&
    typeof candidate.dataModel === 'number' &&
    Array.isArray(candidate.contents) &&
    Array.isArray(candidate.rows) &&
    Array.isArray(candidate.databases) &&
    Array.isArray(candidate.titles) &&
    typeof candidate.mini === 'object' &&
    candidate.mini !== null
  );
}
