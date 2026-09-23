import {
  HocuspocusProvider,
  HocuspocusProviderWebsocket,
  WebSocketStatus,
} from '@hocuspocus/provider';
import { Awareness, type SyncHandle, type SyncProvider, type SyncStatusInfo } from '@tessera/core';
import type * as Y from 'yjs';
import type { AuthMode } from '../client/api';
import { syncSocketUrl } from '../client/server-url';
import { t } from '../i18n';
import { serverDocName } from './doc-names';
import { errorCode, sameStatus, type SyncErrorCode, type TesseraSyncStatus } from './status';

export interface HocuspocusSyncProviderOptions {
  workspaceId: string;
  serverUrl: string;
  mode: AuthMode;
  /** The bearer token (desktop). The web app authenticates with its session cookie. */
  getToken?: () => Promise<string | null>;
  /** A `WebSocket` implementation (Node tests use `ws`). */
  WebSocketPolyfill?: unknown;
  /** Every change made on this device, per doc (bookkeeping for the background sync). */
  onLocalChange?: (docName: string) => void;
  now?: () => number;
  /** Where `online`/`offline` events come from (the window). Null disables them. */
  connectivity?: EventTarget | null;
  isOnline?: () => boolean;
  /** Reconnect delays (tests shorten them). */
  retry?: { delay: number; minDelay: number; maxDelay: number };
}

interface DocEntry {
  docName: string;
  provider: HocuspocusProvider;
  awareness: Awareness;
  authError: { code: SyncErrorCode; message: string } | null;
  authenticated: boolean;
  readOnly: boolean;
  status: TesseraSyncStatus;
  listeners: Set<(info: SyncStatusInfo) => void>;
  waiters: Array<() => void>;
  destroyed: boolean;
}

/** Errors about one deleted page are that page's business, not the workspace's. */
const DOC_LOCAL_ERRORS = new Set<SyncErrorCode>(['document-deleted']);

function errorMessage(code: SyncErrorCode, reason: string): string {
  switch (code) {
    case 'unauthenticated':
      return t('errorSignedOut');
    case 'forbidden':
      return t('errorForbidden');
    case 'origin-not-allowed':
      return t('errorOrigin');
    case 'document-deleted':
      return t('errorDocDeleted');
    case 'invalid-document':
      return t('errorInvalidDocument');
    default:
      return t('errorUnknown', { reason });
  }
}

/**
 * {@link SyncProvider} over Hocuspocus. Every open doc of the workspace shares one WebSocket;
 * it reconnects with exponential backoff and jitter (1 s doubling to 30 s), and right away when
 * the browser comes back online. Edits made while offline stay in the doc (and the `DocStore`)
 * and go out in the handshake after reconnecting; nothing needs a manual step.
 *
 * Statuses: `connecting` until the first connection, `offline` while unreachable, `syncing`
 * while changes wait for the server's acknowledgement (or the background sync has work),
 * `synced`, and `error` when the server refuses the workspace (signed out, no access).
 */
export class HocuspocusSyncProvider implements SyncProvider {
  readonly id = 'hocuspocus';
  readonly socket: HocuspocusProviderWebsocket;
  readonly workspaceId: string;
  readonly serverUrl: string;
  private readonly entries = new Map<HocuspocusProvider, DocEntry>();
  private readonly listeners = new Set<(info: SyncStatusInfo) => void>();
  private readonly now: () => number;
  private readonly connectivity: EventTarget | null;
  private status: TesseraSyncStatus;
  private socketStatus: WebSocketStatus = WebSocketStatus.Connecting;
  private hadConnectionProblem = false;
  private browserOffline: boolean;
  private lastSyncedAt: number | null = null;
  private backgroundPending = 0;
  private localChangeHandler: ((docName: string) => void) | null;
  private disposed = false;

  constructor(private readonly options: HocuspocusSyncProviderOptions) {
    this.workspaceId = options.workspaceId;
    this.serverUrl = options.serverUrl;
    this.now = options.now ?? Date.now;
    this.localChangeHandler = options.onLocalChange ?? null;
    this.connectivity =
      options.connectivity === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.connectivity;
    this.browserOffline = !(
      options.isOnline?.() ?? (typeof navigator === 'undefined' ? true : navigator.onLine !== false)
    );
    const retry = options.retry ?? { delay: 1000, minDelay: 1000, maxDelay: 30_000 };
    this.socket = new HocuspocusProviderWebsocket({
      url: syncSocketUrl(options.serverUrl),
      ...(options.WebSocketPolyfill ? { WebSocketPolyfill: options.WebSocketPolyfill } : {}),
      autoConnect: !this.browserOffline,
      delay: retry.delay,
      minDelay: retry.minDelay,
      maxDelay: retry.maxDelay,
      factor: 2,
      jitter: true,
      maxAttempts: 0,
      onStatus: ({ status }) => {
        this.socketStatus = status;
        if (status === WebSocketStatus.Connected) this.hadConnectionProblem = false;
        this.update();
      },
      onDisconnect: () => {
        this.hadConnectionProblem = true;
        // Every doc authenticates again on the next connection.
        for (const entry of this.entries.values()) entry.authenticated = false;
        this.update();
      },
    });
    this.status = { status: 'connecting', serverUrl: this.serverUrl };
    this.connectivity?.addEventListener('online', this.goOnline);
    this.connectivity?.addEventListener('offline', this.goOffline);
    this.update();
  }

  connect(docName: string, doc: Y.Doc): SyncHandle {
    const awareness = new Awareness(doc);
    const entry: DocEntry = {
      docName,
      provider: null as unknown as HocuspocusProvider,
      awareness,
      authError: null,
      authenticated: false,
      readOnly: false,
      status: { status: 'connecting' },
      listeners: new Set(),
      waiters: [],
      destroyed: false,
    };
    const provider = new HocuspocusProvider({
      name: serverDocName(this.workspaceId, docName),
      document: doc,
      awareness,
      websocketProvider: this.socket,
      // Several providers for one doc may share the socket (live editing and background sync).
      sessionAwareness: true,
      token: () => this.token(),
      onAuthenticated: ({ scope }) => {
        entry.authenticated = true;
        entry.authError = null;
        entry.readOnly = scope === 'readonly';
        this.update();
      },
      onAuthenticationFailed: ({ reason }) => {
        const code = errorCode(reason);
        entry.authenticated = false;
        entry.authError = { code, message: errorMessage(code, reason) };
        this.update();
      },
      onSynced: () => this.update(),
      onUnsyncedChanges: ({ number }) => {
        if (number === 0 && provider.isSynced) this.lastSyncedAt = this.now();
        this.update();
      },
    });
    entry.provider = provider;
    this.entries.set(provider, entry);
    doc.on('update', (_update: Uint8Array, origin: unknown) => {
      if (origin !== provider && !entry.destroyed) this.localChangeHandler?.(docName);
    });
    provider.attach();
    this.update();

    return {
      docName,
      awareness,
      getStatus: () => entry.status,
      onStatus: (listener) => {
        entry.listeners.add(listener);
        return () => entry.listeners.delete(listener);
      },
      whenSynced: () =>
        entry.status.status === 'synced' || entry.destroyed
          ? Promise.resolve()
          : new Promise<void>((resolve) => entry.waiters.push(resolve)),
      destroy: () => {
        if (entry.destroyed) return;
        entry.destroyed = true;
        this.entries.delete(provider);
        provider.destroy();
        for (const resolve of entry.waiters.splice(0)) resolve();
        entry.listeners.clear();
        this.update();
      },
    };
  }

  getStatus(): SyncStatusInfo {
    return this.status;
  }

  onStatus(listener: (info: SyncStatusInfo) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Whether a doc is open (connected live by the runtime). */
  isOpen(docName: string): boolean {
    for (const entry of this.entries.values()) if (entry.docName === docName) return true;
    return false;
  }

  /** Whether an open doc has every local change acknowledged by the server. */
  isDocSynced(docName: string): boolean {
    for (const entry of this.entries.values())
      if (entry.docName === docName && entry.status.status === 'synced') return true;
    return false;
  }

  /** Whether the connection is up and the workspace is authorized (the background sync waits for it). */
  get isReady(): boolean {
    if (this.socketStatus !== WebSocketStatus.Connected) return false;
    const workspace = [...this.entries.values()].find((entry) => entry.docName.startsWith('ws:'));
    return workspace ? workspace.authenticated : true;
  }

  /** The bearer token for background connections. */
  token(): Promise<string> {
    if (this.options.mode !== 'bearer') return Promise.resolve('');
    return (this.options.getToken?.() ?? Promise.resolve(null)).then((token) => token ?? '');
  }

  /**
   * Called for every change made on this device, per doc. The sync feature uses it to mark docs
   * dirty when the doc store can't do it itself (stores other than IndexedDB).
   */
  setLocalChangeHandler(handler: ((docName: string) => void) | null): void {
    this.localChangeHandler = handler;
  }

  /** Reports the background sync's queue (it shows as `syncing`). */
  setBackgroundPending(count: number): void {
    this.backgroundPending = count;
    this.update();
  }

  /**
   * Tries again now: reconnects when offline, and re-authenticates docs the server refused
   * (after signing in again).
   */
  retry(): void {
    if (this.disposed) return;
    for (const entry of this.entries.values()) {
      if (!entry.authError || entry.authError.code === 'document-deleted') continue;
      entry.authError = null;
      void entry.provider.sendToken();
      entry.provider.startSync();
    }
    if (this.socketStatus !== WebSocketStatus.Connected && !this.browserOffline)
      this.reconnectSocket();
    this.update();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.connectivity?.removeEventListener('online', this.goOnline);
    this.connectivity?.removeEventListener('offline', this.goOffline);
    for (const entry of [...this.entries.values()]) {
      entry.destroyed = true;
      entry.provider.destroy();
      for (const resolve of entry.waiters.splice(0)) resolve();
    }
    this.entries.clear();
    this.socket.destroy();
    this.listeners.clear();
  }

  private readonly goOnline = () => {
    this.browserOffline = false;
    if (!this.disposed) this.reconnectSocket();
    this.update();
  };

  /**
   * Connects the socket now. After a quick offline/online flip the old socket may not have
   * reported its close yet: `connect()` then sees it as connected and does nothing, so
   * `shouldConnect` is set first and the close handler reconnects.
   */
  private reconnectSocket(): void {
    this.socket.shouldConnect = true;
    void this.socket.connect();
  }

  private readonly goOffline = () => {
    this.browserOffline = true;
    // Don't wait for timeouts: the connection is gone. Changes keep landing in the doc and the
    // local store, and go out in the handshake when the browser is back online.
    this.socket.disconnect();
    this.update();
  };

  private docStatus(
    entry: DocEntry,
    connectionStatus: TesseraSyncStatus['status'],
  ): TesseraSyncStatus {
    if (entry.authError) {
      return {
        status: 'error',
        error: { message: entry.authError.message, code: entry.authError.code },
      };
    }
    if (connectionStatus !== 'synced') return { status: connectionStatus };
    const pending = entry.provider.unsyncedChanges;
    if (!entry.authenticated || !entry.provider.isSynced)
      return { status: 'syncing', pendingUpdates: pending };
    if (entry.provider.hasUnsyncedChanges) return { status: 'syncing', pendingUpdates: pending };
    const status: TesseraSyncStatus = { status: 'synced', lastSyncedAt: this.lastSyncedAt };
    if (entry.readOnly) status.readOnly = true;
    return status;
  }

  private update(): void {
    if (this.disposed) return;
    const connected = this.socketStatus === WebSocketStatus.Connected;
    const connection: TesseraSyncStatus['status'] = connected
      ? 'synced'
      : this.browserOffline || this.hadConnectionProblem
        ? 'offline'
        : 'connecting';

    let pending = 0;
    let workspaceError: { message: string; code: string } | null = null;
    let busy = this.backgroundPending > 0;
    let readOnly = false;
    for (const entry of this.entries.values()) {
      const next = this.docStatus(entry, connection);
      pending += entry.provider.unsyncedChanges;
      if (entry.readOnly) readOnly = true;
      if (entry.authError && !DOC_LOCAL_ERRORS.has(entry.authError.code))
        workspaceError ??= { message: entry.authError.message, code: entry.authError.code };
      if (next.status === 'syncing') busy = true;
      if (!sameStatus(next, entry.status)) {
        entry.status = next;
        for (const listener of [...entry.listeners]) listener(next);
        if (next.status === 'synced') for (const resolve of entry.waiters.splice(0)) resolve();
      }
    }

    let aggregate: TesseraSyncStatus;
    if (workspaceError) aggregate = { status: 'error', error: workspaceError };
    else if (connection !== 'synced') aggregate = { status: connection, pendingUpdates: pending };
    else if (busy) aggregate = { status: 'syncing', pendingUpdates: pending };
    else aggregate = { status: 'synced' };
    aggregate.serverUrl = this.serverUrl;
    aggregate.lastSyncedAt = this.lastSyncedAt;
    if (this.backgroundPending > 0) aggregate.backgroundPending = this.backgroundPending;
    if (readOnly) aggregate.readOnly = true;
    if (sameStatus(aggregate, this.status)) return;
    this.status = aggregate;
    for (const listener of [...this.listeners]) listener(aggregate);
  }
}
