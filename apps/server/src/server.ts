import { mkdirSync } from 'node:fs';
import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createAdaptorServer } from '@hono/node-server';
import type { Logger } from 'pino';
import { AssetService } from './assets/asset-service';
import { AuthService } from './auth/auth-service';
import type { PasswordHashOptions } from './auth/passwords';
import { RateLimiter } from './auth/rate-limit';
import { setupCodeValue } from './auth/tokens';
import type { ServerConfig } from './config';
import { openDatabase } from './db/database';
import { createHttpApp, SERVER_VERSION } from './http/app';
import type { AppServices } from './http/context';
import { createOriginPolicy } from './http/origins';
import { resolveWebDir } from './http/static';
import { acquireDataDirLock } from './lock';
import { createLogger } from './logger';
import { serverDocName } from './sync/doc-names';
import { DocPersistence } from './sync/persistence';
import { SyncServer } from './sync/sync-server';
import { VersionService } from './versions/version-service';
import { WorkspaceService } from './workspaces/workspace-service';

export interface StartServerOptions {
  config: ServerConfig;
  logger?: Logger;
  /** Clock (tests move it to expire sessions and invites). */
  now?: () => number;
  /** Cheaper password hashing for tests. */
  hashing?: PasswordHashOptions;
  /** Compact a doc once it has this many stored updates. */
  compactAfter?: number;
  /** Periodic maintenance (compaction sweep, expired sessions). Default 10 minutes; 0 disables. */
  maintenanceIntervalMs?: number;
}

export interface TesseraServer {
  /** `http://host:port` the server listens on. */
  readonly url: string;
  readonly port: number;
  readonly services: AppServices;
  readonly sync: SyncServer;
  readonly http: HttpServer;
  /** Stops accepting connections, closes sockets, flushes and closes the database. */
  close(): Promise<void>;
}

/** Starts the Tessera server: the API, the web app and real-time sync on one port. */
export async function startServer(options: StartServerOptions): Promise<TesseraServer> {
  const { config } = options;
  const now = options.now ?? Date.now;
  const logger = options.logger ?? createLogger(config);
  mkdirSync(config.dataDir, { recursive: true });
  const releaseLock = acquireDataDirLock(config.dataDir);

  let db;
  try {
    db = openDatabase(config.dataDir);
  } catch (error) {
    releaseLock();
    throw error;
  }
  const auth = new AuthService(db, {
    sessionDays: config.sessionDays,
    now,
    ...(options.hashing ? { hashing: options.hashing } : {}),
  });
  const workspaces = new WorkspaceService(db, { now });
  const persistence = new DocPersistence(db, {
    now,
    ...(options.compactAfter ? { compactAfter: options.compactAfter } : {}),
    onError: (error, context) =>
      logger.error({ err: error, ...context }, 'document storage problem'),
  });
  const origins = createOriginPolicy(config);
  const setup = { code: auth.hasUsers() ? null : (config.setupCode ?? setupCodeValue()) };
  const hooks = { docDeleted: (_workspaceId: string, _docName: string) => undefined as void };
  const services: AppServices = {
    config,
    db,
    auth,
    workspaces,
    persistence,
    versions: new VersionService(db),
    assets: new AssetService(db, {
      dataDir: config.dataDir,
      maxUploadBytes: config.maxUploadBytes,
      now,
    }),
    rateLimiter: new RateLimiter(now),
    origins,
    logger,
    setup,
    version: SERVER_VERSION,
    now,
    hooks,
  };

  const sync = new SyncServer({
    persistence,
    auth,
    workspaces,
    logger,
    isAllowedOrigin: (origin, host) => origins.isAllowed(origin, host),
  });
  hooks.docDeleted = (workspaceId, docName) =>
    sync.hocuspocus.closeConnections(serverDocName(workspaceId, docName));

  const webDir = resolveWebDir(config.webDir);
  const app = createHttpApp(services, { webDir });
  const http = createAdaptorServer({ fetch: app.fetch }) as HttpServer;
  http.on('upgrade', (request, socket, head) => {
    if (!sync.handleUpgrade(request, socket, head)) socket.destroy();
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(config.port, config.host, () => {
      http.off('error', reject);
      resolve();
    });
  });
  const address = http.address() as AddressInfo;
  const hostForUrl = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  const url = `http://${hostForUrl}:${address.port}`;

  const interval = options.maintenanceIntervalMs ?? 10 * 60_000;
  const maintenance =
    interval > 0
      ? setInterval(() => {
          try {
            persistence.compactBusyDocs(50);
            auth.pruneExpired();
          } catch (error) {
            logger.error({ err: error }, 'maintenance failed');
          }
        }, interval)
      : null;
  maintenance?.unref();

  logger.info(
    { url, dataDir: config.dataDir, webApp: webDir ?? 'not built', signupMode: config.signupMode },
    'Tessera server listening',
  );
  if (setup.code) {
    logger.warn(
      { setupCode: setup.code },
      `First run: open ${config.publicUrl ?? url}, choose "Join a workspace on a server" (or, in an open workspace, Settings → Sync & account → "Connect to a server") and create the owner account with setup code ${setup.code}. Or run "tessera-server create-owner".`,
    );
  }
  if (!webDir) logger.warn('The web app is not built; only the API and sync are served.');

  let closing: Promise<void> | null = null;
  const close = () => {
    closing ??= (async () => {
      if (maintenance) clearInterval(maintenance);
      await sync.shutdown();
      await new Promise<void>((resolve) => {
        http.close(() => resolve());
        http.closeIdleConnections();
        setTimeout(() => http.closeAllConnections(), 2000).unref();
      });
      try {
        persistence.compactBusyDocs(2);
      } catch (error) {
        logger.error({ err: error }, 'final compaction failed');
      }
      db.pragma('wal_checkpoint(TRUNCATE)');
      db.close();
      releaseLock();
      logger.info('Tessera server stopped');
    })();
    return closing;
  };

  return { url, port: address.port, services, sync, http, close };
}
