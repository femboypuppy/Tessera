import { randomUUID } from 'node:crypto';
import type { MiddlewareHandler } from 'hono';
import { forbidden } from '../errors';
import type { AppEnv, AppServices } from './context';
import { readSessionCookie } from './cookies';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Request IDs and one log line per request. */
export function requestLog(services: AppServices): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id')?.slice(0, 64) || randomUUID();
    c.set('requestId', requestId);
    const started = performance.now();
    await next();
    const ms = Math.round(performance.now() - started);
    const status = c.res.status;
    const entry = { requestId, method: c.req.method, path: c.req.path, status, ms };
    if (status >= 500) services.logger.error(entry, 'request failed');
    else services.logger.debug(entry, 'request');
  };
}

/** Security headers on every response. The web app's CSP is set where HTML is served. */
export function securityHeaders(services: AppServices): MiddlewareHandler<AppEnv> {
  const hsts = services.config.publicUrl?.startsWith('https:') ?? false;
  return async (c, next) => {
    await next();
    const headers = c.res.headers;
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    headers.set('X-Frame-Options', 'DENY');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (hsts) headers.set('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    if (c.req.path.startsWith('/api/')) {
      if (!headers.has('Content-Security-Policy'))
        headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
    }
  };
}

/**
 * CORS for the API: allowed origins (the desktop app, `PUBLIC_URL`, `CORS_ORIGINS`, the server's
 * own origin) may send credentials. `/api/health` answers everyone, without credentials, so the
 * connect screen can tell "unreachable" from "this origin isn't allowed".
 */
export function cors(services: AppServices): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const origin = c.req.header('origin');
    const allowed = origin
      ? services.origins.isAllowed(
          origin,
          c.req.header('host') ?? null,
          c.req.header('x-forwarded-proto'),
        )
      : false;
    const isHealth = c.req.path === '/api/health';
    if (c.req.method === 'OPTIONS' && origin) {
      if (!allowed && !isHealth) return c.body(null, 403);
      const headers = new Headers({
        'Access-Control-Allow-Origin': allowed ? origin : '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers':
          c.req.header('access-control-request-headers') ??
          'Content-Type, Authorization, X-Tessera-Asset-Name',
        'Access-Control-Max-Age': '600',
        Vary: 'Origin',
      });
      if (allowed) headers.set('Access-Control-Allow-Credentials', 'true');
      return new Response(null, { status: 204, headers });
    }
    await next();
    if (!origin) return;
    if (allowed) {
      c.res.headers.set('Access-Control-Allow-Origin', origin);
      c.res.headers.set('Access-Control-Allow-Credentials', 'true');
      c.res.headers.set(
        'Access-Control-Expose-Headers',
        'X-Tessera-Asset-Name, X-Tessera-Created-At, Retry-After, Content-Disposition',
      );
      c.res.headers.append('Vary', 'Origin');
    } else if (isHealth) {
      c.res.headers.set('Access-Control-Allow-Origin', '*');
    }
  };
}

/** Resolves the caller from a bearer token or the session cookie. */
export function authenticate(services: AppServices): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header('authorization');
    let state = null;
    if (header?.toLowerCase().startsWith('bearer ')) {
      const resolved = services.auth.resolveToken(header.slice(7).trim());
      if (resolved) state = { ...resolved, via: 'bearer' as const };
    } else {
      const resolved = services.auth.resolveToken(readSessionCookie(c.req.header('cookie')));
      if (resolved) state = { ...resolved, via: 'cookie' as const };
    }
    c.set('auth', state);
    await next();
  };
}

/**
 * CSRF protection. Cookies are sent by the browser automatically, so a state-changing request
 * that relies on them (or that could set one, like signing in) must come from an allowed origin.
 * Bearer-token requests carry their credential explicitly and need no check.
 */
export function csrf(services: AppServices): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method) || !c.req.path.startsWith('/api/')) return next();
    if (c.req.header('authorization')?.toLowerCase().startsWith('bearer ')) return next();
    const origin = c.req.header('origin');
    if (origin) {
      if (
        !services.origins.isAllowed(
          origin,
          c.req.header('host') ?? null,
          c.req.header('x-forwarded-proto'),
        )
      )
        throw forbidden('Requests from this address are not allowed.');
      return next();
    }
    // No Origin: only non-browser clients do that, and they have no ambient cookie to abuse,
    // unless the request carries one; then fall back to Fetch Metadata.
    if (c.req.header('cookie')) {
      const site = c.req.header('sec-fetch-site');
      if (site && site !== 'same-origin' && site !== 'none')
        throw forbidden('Requests from this address are not allowed.');
    }
    return next();
  };
}
