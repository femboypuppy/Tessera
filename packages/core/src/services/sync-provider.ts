import { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

export { Awareness };

/**
 * Sync state of one doc, or of the whole workspace connection.
 * - `local`: no server configured; changes stay on this device (the in-memory and browser default).
 * - `offline`: a server is configured but unreachable; edits are kept and sync on reconnect.
 * - `connecting`: opening the connection or authenticating.
 * - `syncing`: connected; exchanging updates or waiting for local changes to be acknowledged.
 * - `synced`: connected and every local change is acknowledged by the server.
 * - `error`: a non-transient problem (authentication, permissions); see `error`.
 */
export type SyncStatus = 'local' | 'offline' | 'connecting' | 'syncing' | 'synced' | 'error';

/** Sync state with details. */
export interface SyncStatusInfo {
  status: SyncStatus;
  /** For `error` (and optionally `offline`): what went wrong, in plain language. */
  error?: { message: string; code?: string };
  /** Epoch milliseconds of the last moment everything was synced. */
  lastSyncedAt?: number | null;
  /** Local updates not yet acknowledged by the server. */
  pendingUpdates?: number;
  /**
   * The server gave this device a read-only connection (the viewer role): the shell makes pages
   * read-only, because edits would stay on this device.
   */
  readOnly?: boolean;
}

/**
 * The live connection of one doc. The runtime creates it after the doc is loaded from the
 * `DocStore` and destroys it when the doc is released.
 *
 * Awareness state conventions (the runtime sets `user`; the editor sets cursor fields):
 * `{ user: { id, name, color }, cursor?: { anchor, head } (y-prosemirror relative positions) }`.
 * Awareness is ephemeral: never persist it.
 */
export interface SyncHandle {
  readonly docName: string;
  getStatus(): SyncStatusInfo;
  onStatus(listener: (info: SyncStatusInfo) => void): () => void;
  /** Awareness (presence) for this doc. Always present, also when local-only. */
  readonly awareness: Awareness;
  /** Resolves once the doc is in sync with the server (immediately when local-only). */
  whenSynced(): Promise<void>;
  destroy(): void;
}

/**
 * Connects docs to a sync backend. Implementations: local-only (core, priority 0) and Hocuspocus
 * (`@tessera/sync`, 50, available when the workspace has a `serverUrl`). One provider serves a
 * workspace session and may multiplex every doc over one connection.
 *
 * @example
 * const handle = provider.connect('page:abc', doc);
 * handle.onStatus(({ status }) => setBadge(status));
 */
export interface SyncProvider {
  readonly id: string;
  connect(docName: string, doc: Y.Doc): SyncHandle;
  /** Aggregate status of the whole connection (the top bar indicator). */
  getStatus(): SyncStatusInfo;
  onStatus(listener: (info: SyncStatusInfo) => void): () => void;
  dispose?(): void | Promise<void>;
}

const LOCAL_STATUS: SyncStatusInfo = { status: 'local' };

/** Local-only {@link SyncProvider}: no network, status `local`, a working local awareness. */
export class LocalSyncProvider implements SyncProvider {
  readonly id = 'local';

  connect(docName: string, doc: Y.Doc): SyncHandle {
    const awareness = new Awareness(doc);
    let destroyed = false;
    return {
      docName,
      awareness,
      getStatus: () => LOCAL_STATUS,
      onStatus: () => () => undefined,
      whenSynced: () => Promise.resolve(),
      destroy: () => {
        if (destroyed) return;
        destroyed = true;
        awareness.destroy();
      },
    };
  }

  getStatus(): SyncStatusInfo {
    return LOCAL_STATUS;
  }

  onStatus(_listener: (info: SyncStatusInfo) => void): () => void {
    return () => undefined;
  }
}
