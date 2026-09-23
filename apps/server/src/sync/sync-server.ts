import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  Hocuspocus,
  type Document,
  type Extension,
  type WebSocketLike as HocuspocusSocket,
} from '@hocuspocus/server';
import type { Logger } from 'pino';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import * as Y from 'yjs';
import type { AuthService } from '../auth/auth-service';
import { readSessionCookie } from '../http/cookies';
import type { Role, WorkspaceService } from '../workspaces/workspace-service';
import { parseServerDocName } from './doc-names';
import type { DocPersistence } from './persistence';

/** What a connection is allowed to do, attached to every document connection. */
export interface SyncContext {
  userId: string;
  userName: string;
  sessionId: string;
  workspaceId: string;
  docName: string;
  role: Role;
}

/** WebSocket close codes the client understands. */
export const CLOSE = {
  unauthorized: { code: 4401, reason: 'unauthorized' },
  forbidden: { code: 4403, reason: 'forbidden' },
} as const;

/** Reasons sent with a denied document (the client maps them to messages). */
export type DenyReason =
  'unauthenticated' | 'forbidden' | 'invalid-document' | 'document-deleted' | 'origin-not-allowed';

/** Answers an upgrade request with a complete HTTP error response, then closes the socket. */
function rejectUpgrade(socket: Duplex, status: number, message: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  socket.once('finish', () => socket.destroy());
  socket.end(
    `HTTP/1.1 ${status} ${message}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`,
  );
}

function deny(reason: DenyReason, message: string): Error {
  return Object.assign(new Error(message), { reason });
}

/** Transaction origin of the state loaded from SQLite (never stored again). */
const LOAD_ORIGIN = Symbol('tessera:load');

/** Awareness states larger than this are dropped (presence is small; this is abuse). */
const MAX_AWARENESS_BYTES = 32 * 1024;
const COLOR = /^#[0-9a-fA-F]{6}$/;

function isSyncContext(value: unknown): value is SyncContext {
  if (!value || typeof value !== 'object') return false;
  const context = value as Partial<SyncContext>;
  return typeof context.userId === 'string' && typeof context.sessionId === 'string';
}

export interface SyncServerOptions {
  persistence: DocPersistence;
  auth: AuthService;
  workspaces: WorkspaceService;
  logger: Logger;
  /** Browsers send an Origin; cookie sessions are accepted only from allowed ones. */
  isAllowedOrigin(origin: string, requestHost: string | null): boolean;
  /** WebSocket path. Default `/sync`. */
  path?: string;
  /** Largest WebSocket message. Default 64 MB (a big doc's first sync). */
  maxPayloadBytes?: number;
}

/**
 * The real-time sync endpoint: Hocuspocus over `ws`, sharing the HTTP server with the API.
 *
 * - **Auth** per document (`onAuthenticate`): a bearer token in the Hocuspocus auth message
 *   (desktop, scripts) or the session cookie of the upgrade request (web, allowed origins only,
 *   against cross-site WebSocket hijacking). The workspace in the doc name must be one the user
 *   belongs to. Viewers get read-only connections; Hocuspocus then refuses their sync updates,
 *   including hand-crafted ones. Sessions are re-checked on every message; revoked sessions and
 *   changed memberships close their sockets at once.
 * - **Persistence**: every update is stored in SQLite synchronously while it is applied, before
 *   Hocuspocus acknowledges it, so an acknowledged update survives a crash.
 * - **Awareness** is never stored. Each state's `user` is rewritten to the authenticated account,
 *   so nobody can appear as someone else.
 */
export class SyncServer {
  readonly hocuspocus: Hocuspocus<SyncContext>;
  private readonly wss: WebSocketServer;
  private readonly path: string;
  /** Live sockets and the sessions and memberships they carry. */
  private readonly sockets = new Map<
    HocuspocusSocket,
    { sessionIds: Set<string>; members: Set<string> }
  >();
  /** Which connection owns which awareness client ID, per document. */
  private readonly awarenessOwners = new WeakMap<Document, Map<number, string>>();
  private readonly offs: Array<() => void> = [];
  private closing = false;

  constructor(private readonly options: SyncServerOptions) {
    this.path = options.path ?? '/sync';
    this.wss = new WebSocketServer({
      noServer: true,
      maxPayload: options.maxPayloadBytes ?? 64 * 1024 * 1024,
    });
    this.hocuspocus = new Hocuspocus<SyncContext>({
      name: 'tessera',
      quiet: true,
      extensions: [this.extension()],
      timeout: 60_000,
      unloadImmediately: true,
      yDocOptions: { gc: true, gcFilter: () => true },
    });
    this.offs.push(
      options.auth.onSessionsRevoked((ids) => {
        for (const id of ids)
          this.closeWhere((entry) => entry.sessionIds.has(id), CLOSE.unauthorized);
      }),
      options.workspaces.onMembershipChanged((workspaceId, userId) => {
        const key = `${workspaceId}\u0000${userId}`;
        this.closeWhere((entry) => entry.members.has(key), CLOSE.forbidden);
      }),
    );
  }

  /** Handles an HTTP upgrade. Returns false when the path isn't the sync endpoint. */
  handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== this.path) return false;
    if (this.closing) {
      rejectUpgrade(socket, 503, 'Service Unavailable');
      return true;
    }
    const origin = request.headers.origin;
    if (origin && !this.options.isAllowedOrigin(origin, request.headers.host ?? null)) {
      this.options.logger.warn({ origin }, 'rejected a WebSocket from a foreign origin');
      rejectUpgrade(socket, 403, 'Forbidden');
      return true;
    }
    this.wss.handleUpgrade(request, socket, head, (ws) => this.accept(ws, request));
    return true;
  }

  /** Closes every connection, lets documents unload, and stops accepting new ones. */
  async shutdown(timeoutMs = 10_000): Promise<void> {
    this.closing = true;
    for (const off of this.offs.splice(0)) off();
    this.hocuspocus.closeConnections();
    for (const socket of this.sockets.keys()) socket.close(1001, 'server shutting down');
    this.hocuspocus.flushPendingStores();
    const deadline = Date.now() + timeoutMs;
    while (this.hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    this.wss.close();
  }

  /** Number of open sockets (health, load tests). */
  get socketCount(): number {
    return this.sockets.size;
  }

  private accept(ws: WebSocket, request: IncomingMessage): void {
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (Array.isArray(value)) for (const item of value) headers.append(name, item);
      else if (value !== undefined) headers.set(name, value);
    }
    const fetchRequest = new Request(
      `http://${request.headers.host ?? 'localhost'}${request.url ?? '/'}`,
      {
        headers,
      },
    );
    const socket = ws as unknown as HocuspocusSocket;
    this.sockets.set(socket, { sessionIds: new Set(), members: new Set() });
    const client = this.hocuspocus.handleConnection(socket, fetchRequest);
    ws.on('message', (data: RawData) => {
      const bytes =
        data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : Array.isArray(data)
            ? new Uint8Array(Buffer.concat(data))
            : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      client.handleMessage(bytes);
    });
    ws.on('close', (code: number, reason: Buffer) => {
      this.sockets.delete(socket);
      client.handleClose({ code, reason: reason.toString() });
    });
    ws.on('error', (error: Error) => {
      this.options.logger.debug({ err: error }, 'WebSocket error');
    });
  }

  private closeWhere(
    match: (entry: { sessionIds: Set<string>; members: Set<string> }) => boolean,
    event: { code: number; reason: string },
  ): void {
    for (const [socket, entry] of this.sockets) {
      if (match(entry)) socket.close(event.code, event.reason);
    }
  }

  private extension(): Extension<SyncContext> {
    const { auth, workspaces, persistence, logger } = this.options;
    return {
      extensionName: 'tessera',

      onAuthenticate: async ({ token, documentName, requestHeaders, connectionConfig }) => {
        const target = parseServerDocName(documentName);
        if (!target) throw deny('invalid-document', 'This is not a Tessera document.');
        let resolved = token ? auth.resolveToken(token) : null;
        if (!resolved && !token) {
          // Cookies are ambient: only trust them from origins the server allows.
          const origin = requestHeaders.get('origin');
          if (origin && !this.options.isAllowedOrigin(origin, requestHeaders.get('host')))
            throw deny('origin-not-allowed', 'This app’s address is not allowed by the server.');
          resolved = auth.resolveToken(readSessionCookie(requestHeaders.get('cookie')));
        }
        if (!resolved) throw deny('unauthenticated', 'Sign in to sync.');
        const role = workspaces.roleOf(target.workspaceId, resolved.user.id);
        if (!role) throw deny('forbidden', 'You are not a member of this workspace.');
        if (persistence.isDeleted(target.workspaceId, target.docName))
          throw deny('document-deleted', 'This page was deleted permanently.');
        connectionConfig.readOnly = role === 'viewer';
        const context: SyncContext = {
          userId: resolved.user.id,
          userName: resolved.user.name,
          sessionId: resolved.session.id,
          workspaceId: target.workspaceId,
          docName: target.docName,
          role,
        };
        return context;
      },

      connected: async ({ connection, context }) => {
        const entry = this.sockets.get(connection.webSocket);
        if (!entry || !isSyncContext(context)) return;
        entry.sessionIds.add(context.sessionId);
        entry.members.add(`${context.workspaceId}\u0000${context.userId}`);
      },

      onLoadDocument: async ({ document, documentName }) => {
        const target = parseServerDocName(documentName);
        if (!target) throw deny('invalid-document', 'This is not a Tessera document.');
        const state = persistence.load(target.workspaceId, target.docName);
        if (state) Y.applyUpdate(document, state, LOAD_ORIGIN);
      },

      afterLoadDocument: async ({ document, documentName }) => {
        const target = parseServerDocName(documentName);
        if (!target) return;
        document.on('update', (update: Uint8Array, origin: unknown) => {
          if (origin === LOAD_ORIGIN) return;
          // Synchronous: this runs inside the Yjs transaction, before Hocuspocus sends the
          // acknowledgement to the client.
          try {
            persistence.append(target.workspaceId, target.docName, update);
          } catch (error) {
            // Kept in memory; the client still has it too and resends on reconnect.
            logger.error({ err: error, doc: documentName }, 'could not store an update');
          }
        });
      },

      beforeHandleMessage: async ({ context, connection }) => {
        if (!isSyncContext(context)) return;
        if (!auth.isSessionActive(context.sessionId)) {
          connection.webSocket.close(CLOSE.unauthorized.code, CLOSE.unauthorized.reason);
          throw Object.assign(new Error('Session expired'), CLOSE.unauthorized);
        }
      },

      beforeHandleAwareness: async ({ states, context, document, connection }) => {
        if (!isSyncContext(context) || !connection) return;
        let owners = this.awarenessOwners.get(document);
        if (!owners) {
          owners = new Map();
          this.awarenessOwners.set(document, owners);
        }
        for (const [clientId, state] of states) {
          const owner = owners.get(clientId);
          if (owner && owner !== connection.socketId) {
            // Someone else's presence: a connection may only speak for its own clients.
            states.delete(clientId);
            continue;
          }
          owners.set(clientId, connection.socketId);
          if (!state || typeof state !== 'object') continue;
          if (JSON.stringify(state).length > MAX_AWARENESS_BYTES) {
            states.delete(clientId);
            continue;
          }
          const claimed = (state as { user?: { color?: unknown } }).user;
          const color =
            typeof claimed?.color === 'string' && COLOR.test(claimed.color) ? claimed.color : null;
          (state as Record<string, unknown>).user = {
            id: context.userId,
            name: context.userName,
            color,
          };
        }
      },

      afterUnloadDocument: async ({ documentName }) => {
        const target = parseServerDocName(documentName);
        if (!target) return;
        try {
          if (persistence.updateCount(target.workspaceId, target.docName) > 1)
            persistence.compact(target.workspaceId, target.docName);
        } catch (error) {
          logger.error({ err: error, doc: documentName }, 'compaction after unload failed');
        }
      },
    };
  }
}
