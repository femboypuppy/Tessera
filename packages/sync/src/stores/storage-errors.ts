import { asError } from '../errors';
import { isQuotaError } from '../idb/idb';

/** What went wrong with local storage, for the toast and the status indicator. */
export interface StorageErrorInfo {
  /**
   * - `quota`: the disk or the browser's storage quota is full. Writes are kept in memory and
   *   retried; nothing is lost while the tab stays open.
   * - `closed`: another tab deleted or upgraded this workspace's database.
   * - `unknown`: anything else (reported with the error).
   */
  kind: 'quota' | 'closed' | 'unknown';
  operation: 'load' | 'store' | 'compact' | 'delete' | 'asset';
  error: Error;
  docName?: string;
}

/** Listeners for storage errors, shared by the IndexedDB stores. */
export class StorageErrorEmitter {
  private readonly listeners = new Set<(info: StorageErrorInfo) => void>();
  private last: StorageErrorInfo | null = null;

  subscribe(listener: (info: StorageErrorInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The most recent error, or null once a write succeeded after it. */
  current(): StorageErrorInfo | null {
    return this.last;
  }

  emit(operation: StorageErrorInfo['operation'], error: unknown, docName?: string): void {
    const err = asError(error);
    const info: StorageErrorInfo = {
      kind: isQuotaError(err) ? 'quota' : err.name === 'StoreClosedError' ? 'closed' : 'unknown',
      operation,
      error: err,
    };
    if (docName) info.docName = docName;
    this.last = info;
    for (const listener of [...this.listeners]) {
      try {
        listener(info);
      } catch (listenerError) {
        console.error('[sync] storage error listener failed', listenerError);
      }
    }
  }

  /** A write succeeded: storage works again. */
  recovered(): void {
    this.last = null;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Thrown once a store was disposed or its database was deleted from another tab. */
export class StoreClosedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreClosedError';
  }
}
