import type { HttpBindings } from '@hono/node-server';
import type { Context } from 'hono';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AuthService, Session, User } from '../auth/auth-service';
import type { RateLimiter } from '../auth/rate-limit';
import type { AssetService } from '../assets/asset-service';
import type { ServerConfig } from '../config';
import type { Db } from '../db/database';
import { HttpError, invalid, unauthorized } from '../errors';
import type { DocPersistence } from '../sync/persistence';
import type { VersionService } from '../versions/version-service';
import type { WorkspaceService } from '../workspaces/workspace-service';
import type { OriginPolicy } from './origins';

/** The signed-in caller of a request. */
export interface AuthState {
  user: User;
  session: Session;
  via: 'cookie' | 'bearer';
}

/** The first-run setup: a code the owner types into the web form (null once set up). */
export interface SetupState {
  code: string | null;
}

/** Everything route handlers use. */
export interface AppServices {
  config: ServerConfig;
  db: Db;
  auth: AuthService;
  workspaces: WorkspaceService;
  persistence: DocPersistence;
  versions: VersionService;
  assets: AssetService;
  rateLimiter: RateLimiter;
  origins: OriginPolicy;
  logger: Logger;
  setup: SetupState;
  version: string;
  now: () => number;
  /** Side effects in other parts of the server (the sync server disconnects editors). */
  hooks: { docDeleted(workspaceId: string, docName: string): void };
}

export type AppEnv = {
  Bindings: Partial<HttpBindings>;
  Variables: { auth: AuthState | null; requestId: string };
};

export type AppContext = Context<AppEnv>;

/** The caller, or a 401. */
export function requireAuth(c: AppContext): AuthState {
  const auth = c.get('auth');
  if (!auth) throw unauthorized();
  return auth;
}

/** Parses and validates a JSON body (400 with the issues when it doesn't match). */
export async function readJson<T extends z.ZodType>(c: AppContext, schema: T): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw invalid('The request body must be JSON.');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') ?? '';
    throw invalid(
      field ? `${field}: ${first?.message ?? 'invalid'}` : (first?.message ?? 'Invalid request.'),
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** The client's IP (the socket's, or `X-Forwarded-For` behind a trusted proxy). */
export function clientIp(c: AppContext, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
    if (forwarded) return forwarded;
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

/** Whether the request came over HTTPS (for the cookie's `Secure` flag). */
export function isHttps(c: AppContext, config: ServerConfig): boolean {
  if (config.trustProxy && c.req.header('x-forwarded-proto') === 'https') return true;
  if (config.publicUrl?.startsWith('https:')) return true;
  return new URL(c.req.url).protocol === 'https:';
}

/** Throws a 429 when `key` exceeded its budget. */
export function limit(services: AppServices, key: string, max: number, windowMs: number): void {
  const wait = services.rateLimiter.hit(key, max, windowMs);
  if (wait > 0)
    throw new HttpError(429, 'rate_limited', `Too many attempts. Try again in ${wait} seconds.`, {
      retryAfter: wait,
    });
}

/** Common field schemas. */
export const fields = {
  email: z.email('must be an email address').max(254),
  name: z.string().trim().min(1, 'must not be empty').max(80, 'must be at most 80 characters'),
  password: z
    .string()
    .min(8, 'must be at least 8 characters')
    .max(256, 'must be at most 256 characters'),
  workspaceName: z.string().trim().min(1, 'must not be empty').max(100),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'must be a valid ID'),
};
