/**
 * Small promise helpers over the IndexedDB API. Everything else in `@tessera/sync` talks to
 * IndexedDB through these, so the transaction rules (what may run inside a transaction, when it
 * commits) live in one place.
 */

/** Resolves with a request's result, rejects with its error. */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Resolves when a transaction commits; rejects when it errors or aborts. Only a committed
 * transaction is durable, so writers resolve their callers from here, never from a request's
 * `success` event.
 */
export function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    const fail = () =>
      reject(transaction.error ?? new DOMException('The transaction was aborted', 'AbortError'));
    transaction.onerror = (event) => {
      // Keep the error from also surfacing as an uncaught error on the database.
      event.preventDefault();
      fail();
    };
    transaction.onabort = fail;
  });
}

export interface OpenDatabaseOptions {
  factory: IDBFactory;
  name: string;
  version: number;
  upgrade(db: IDBDatabase, oldVersion: number, transaction: IDBTransaction): void;
  /** Another tab wants to delete or upgrade the database: close and stop using it. */
  onVersionChange?(): void;
}

/** Opens (and creates or upgrades) a database. */
export function openDatabase(options: OpenDatabaseOptions): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = options.factory.open(options.name, options.version);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    request.onupgradeneeded = (event) => {
      const transaction = request.transaction;
      if (transaction) options.upgrade(request.result, event.oldVersion, transaction);
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        options.onVersionChange?.();
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error ?? new Error(`Could not open ${options.name}`));
    request.onblocked = () => {
      // An older connection in another tab is still open; `onsuccess` follows once it closes.
    };
  });
}

/** Deletes a database. Resolves once it is gone (open connections are asked to close first). */
export function deleteDatabase(factory: IDBFactory, name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error(`Could not delete ${name}`));
  });
}

/** True for "the disk or the browser's storage quota is full" errors, across browsers. */
export function isQuotaError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { name, code, message } = error as { name?: unknown; code?: unknown; message?: unknown };
  if (name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  // Legacy DOMException code for QUOTA_EXCEEDED_ERR.
  if (code === 22) return true;
  return typeof message === 'string' && /quota/i.test(message);
}

/** The global IndexedDB factory, or null where there is none (Node without a polyfill). */
export function defaultIndexedDb(): IDBFactory | null {
  return typeof indexedDB === 'undefined' ? null : indexedDB;
}

/** Reads a stored binary value (IndexedDB returns typed arrays, possibly from another realm). */
export function asBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value))
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}
