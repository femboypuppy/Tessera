import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  bootstrap,
  SETUP_CODE,
  signUp,
  startTestServer,
  testClock,
  cleanupServers,
  type TestServer,
} from '../testing/harness';

const servers: TestServer[] = [];

async function server(...args: Parameters<typeof startTestServer>): Promise<TestServer> {
  const t = await startTestServer(...args);
  servers.push(t);
  return t;
}

afterEach(async () => {
  await cleanupServers(servers);
});

const owner = {
  name: 'Ada Owner',
  email: 'ada@example.com',
  password: 'correct horse battery',
};

describe('health and first run', () => {
  it('reports health and whether setup is needed', async () => {
    const t = await server();
    const health = await t.api('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({
      ok: true,
      name: 'tessera',
      setupRequired: true,
      signupMode: 'open',
    });
    await bootstrap(t);
    expect((await t.api('GET', '/api/health')).body).toMatchObject({ setupRequired: false });
  });

  it('creates the owner only with the setup code, and only once', async () => {
    const t = await server();
    const wrong = await t.api('POST', '/api/auth/setup', {
      body: { ...owner, setupCode: 'WRONG-CODE' },
    });
    expect(wrong.status).toBe(403);
    const signupFirst = await t.api('POST', '/api/auth/signup', { body: owner });
    expect(signupFirst.status).toBe(409);
    const ok = await t.api('POST', '/api/auth/setup', {
      body: { ...owner, setupCode: SETUP_CODE.toLowerCase() },
    });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({ user: { email: 'ada@example.com', isOwner: true } });
    const again = await t.api('POST', '/api/auth/setup', {
      body: { ...owner, email: 'mallory@example.com', setupCode: SETUP_CODE },
    });
    expect(again.status).toBe(409);
  });

  it('validates input with clear messages', async () => {
    const t = await server();
    const response = await t.api<{ error: { code: string; message: string } }>(
      'POST',
      '/api/auth/setup',
      {
        body: { ...owner, setupCode: SETUP_CODE, password: 'short' },
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.error.message).toBe('password: must be at least 8 characters');
    const notJson = await t.api('POST', '/api/auth/login', {
      raw: 'nope',
      headers: { 'content-type': 'application/json' },
    });
    expect(notJson.status).toBe(400);
  });
});

describe('sessions', () => {
  it('signs in the web app with an httpOnly, SameSite session cookie', async () => {
    const t = await server();
    await bootstrap(t);
    const login = await t.api('POST', '/api/auth/login', {
      body: { email: owner.email, password: owner.password },
    });
    expect(login.status).toBe(201);
    expect(login.body).not.toHaveProperty('token');
    const cookie = login.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/^tessera_session=[\w-]+;/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    const session = cookie.split(';')[0] ?? '';
    const me = await t.api('GET', '/api/auth/me', { cookie: session });
    expect(me.status).toBe(200);
    expect(me.body).toMatchObject({
      user: { email: owner.email },
      session: { kind: 'cookie', current: true },
    });
    const logout = await t.api('POST', '/api/auth/logout', { cookie: session, origin: t.url });
    expect(logout.status).toBe(204);
    expect((await t.api('GET', '/api/auth/me', { cookie: session })).status).toBe(401);
  });

  it('marks the cookie Secure behind an https PUBLIC_URL', async () => {
    const t = await server({ publicUrl: 'https://notes.example.com' });
    await bootstrap(t);
    const login = await t.api('POST', '/api/auth/login', {
      body: { email: owner.email, password: owner.password },
    });
    expect(login.headers.get('set-cookie')).toMatch(/Secure/);
  });

  it('gives the desktop app a bearer token', async () => {
    const t = await server();
    await bootstrap(t);
    const login = await t.api<{ token: string }>('POST', '/api/auth/login', {
      body: {
        email: owner.email,
        password: owner.password,
        client: 'desktop',
        deviceName: 'Ada’s laptop',
      },
    });
    expect(login.headers.get('set-cookie')).toBeNull();
    expect(login.body.token).toMatch(/^[\w-]{40,}$/);
    const me = await t.api('GET', '/api/auth/me', { token: login.body.token });
    expect(me.body).toMatchObject({ session: { kind: 'bearer', deviceName: 'Ada’s laptop' } });
  });

  it('rejects wrong passwords and unknown accounts the same way', async () => {
    const t = await server();
    await bootstrap(t);
    const wrong = await t.api('POST', '/api/auth/login', {
      body: { email: owner.email, password: 'nope nope nope' },
    });
    const unknown = await t.api('POST', '/api/auth/login', {
      body: { email: 'who@example.com', password: 'nope nope nope' },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });

  it('rejects expired sessions', async () => {
    const clock = testClock();
    const t = await server({ sessionDays: 1 }, { now: clock.now });
    const { ownerToken } = await bootstrap(t);
    expect((await t.api('GET', '/api/auth/me', { token: ownerToken })).status).toBe(200);
    clock.advance(25 * 60 * 60 * 1000);
    expect((await t.api('GET', '/api/auth/me', { token: ownerToken })).status).toBe(401);
  });

  it('keeps active sessions alive (sliding expiry)', async () => {
    const clock = testClock();
    const t = await server({ sessionDays: 1 }, { now: clock.now });
    const { ownerToken } = await bootstrap(t);
    for (let hour = 0; hour < 48; hour += 12) {
      clock.advance(12 * 60 * 60 * 1000);
      expect((await t.api('GET', '/api/auth/me', { token: ownerToken })).status).toBe(200);
    }
  });

  it('lists devices and signs one out', async () => {
    const t = await server();
    const { ownerToken } = await bootstrap(t);
    const phone = await t.api<{ token: string; session: { id: string } }>(
      'POST',
      '/api/auth/login',
      {
        body: {
          email: owner.email,
          password: owner.password,
          client: 'desktop',
          deviceName: 'Phone',
        },
      },
    );
    const list = await t.api<{
      sessions: Array<{ id: string; current: boolean; deviceName: string | null }>;
    }>('GET', '/api/auth/sessions', { token: ownerToken });
    expect(list.body.sessions).toHaveLength(2);
    expect(list.body.sessions.filter((session) => session.current)).toHaveLength(1);
    const revoke = await t.api('DELETE', `/api/auth/sessions/${phone.body.session.id}`, {
      token: ownerToken,
    });
    expect(revoke.status).toBe(204);
    expect((await t.api('GET', '/api/auth/me', { token: phone.body.token })).status).toBe(401);
    // Someone else's session ID is not found.
    const other = await signUp(t, 'eve@example.com');
    const theirs = await t.api<{ sessions: Array<{ id: string }> }>('GET', '/api/auth/sessions', {
      token: other.token,
    });
    const theirId = theirs.body.sessions[0]?.id ?? '';
    expect(
      (await t.api('DELETE', `/api/auth/sessions/${theirId}`, { token: ownerToken })).status,
    ).toBe(404);
  });

  it('rate-limits sign-in attempts', async () => {
    const t = await server();
    await bootstrap(t);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const response = await t.api('POST', '/api/auth/login', {
        body: { email: owner.email, password: `wrong ${i} password` },
      });
      statuses.push(response.status);
      if (response.status === 429)
        expect(Number(response.headers.get('retry-after'))).toBeGreaterThan(0);
    }
    expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
  });
});

describe('sign-up modes', () => {
  it('open: anyone can sign up', async () => {
    const t = await server({ signupMode: 'open' });
    await bootstrap(t);
    const response = await t.api('POST', '/api/auth/signup', {
      body: { name: 'Grace', email: 'grace@example.com', password: 'a fine password' },
    });
    expect(response.status).toBe(201);
    const duplicate = await t.api('POST', '/api/auth/signup', {
      body: { name: 'Grace', email: 'GRACE@example.com', password: 'a fine password' },
    });
    expect(duplicate.status).toBe(409);
  });

  it('invite: only with a valid invite, which also grants access', async () => {
    const t = await server({ signupMode: 'invite' });
    const { ownerToken, workspaceId } = await bootstrap(t);
    const denied = await t.api('POST', '/api/auth/signup', {
      body: { name: 'Grace', email: 'grace@example.com', password: 'a fine password' },
    });
    expect(denied.status).toBe(403);
    const invite = await t.api<{ token: string }>(
      'POST',
      `/api/workspaces/${workspaceId}/invites`,
      {
        token: ownerToken,
        body: { role: 'editor' },
      },
    );
    const joined = await t.api<{ token: string }>('POST', '/api/auth/signup', {
      body: {
        name: 'Grace',
        email: 'grace@example.com',
        password: 'a fine password',
        inviteToken: invite.body.token,
        client: 'desktop',
      },
    });
    expect(joined.status).toBe(201);
    const list = await t.api<{ workspaces: Array<{ id: string; role: string }> }>(
      'GET',
      '/api/workspaces',
      {
        token: joined.body.token,
      },
    );
    expect(list.body.workspaces).toEqual([
      expect.objectContaining({ id: workspaceId, role: 'editor' }),
    ]);
  });

  it('closed: nobody can sign up', async () => {
    const t = await server({ signupMode: 'closed' });
    await bootstrap(t);
    const response = await t.api('POST', '/api/auth/signup', {
      body: { name: 'Grace', email: 'grace@example.com', password: 'a fine password' },
    });
    expect(response.status).toBe(403);
  });
});

describe('browser protections', () => {
  it('sends security headers', async () => {
    const t = await server();
    const response = await t.api('GET', '/api/health');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('allows credentials only from allowed origins (the desktop app, CORS_ORIGINS, itself)', async () => {
    const t = await server({ corsOrigins: ['http://localhost:5173'] });
    const preflight = await fetch(`${t.url}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    expect(preflight.headers.get('access-control-allow-credentials')).toBe('true');
    const desktop = await t.api('GET', '/api/auth/me', { origin: 'tauri://localhost' });
    expect(desktop.headers.get('access-control-allow-origin')).toBe('tauri://localhost');
    const evil = await fetch(`${t.url}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'POST' },
    });
    expect(evil.status).toBe(403);
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
    // Health answers everyone (no credentials), so a connect screen can diagnose problems.
    const health = await t.api('GET', '/api/health', { origin: 'https://evil.example' });
    expect(health.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('refuses cookie-authenticated writes from foreign origins (CSRF)', async () => {
    const t = await server();
    await bootstrap(t);
    const login = await t.api('POST', '/api/auth/login', {
      body: { email: owner.email, password: owner.password },
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const forged = await t.api('POST', '/api/workspaces', {
      cookie,
      origin: 'https://evil.example',
      body: { name: 'Pwned' },
    });
    expect(forged.status).toBe(403);
    const crossSite = await t.api('POST', '/api/workspaces', {
      cookie,
      headers: { 'sec-fetch-site': 'cross-site' },
      body: { name: 'Pwned' },
    });
    expect(crossSite.status).toBe(403);
    const sameOrigin = await t.api('POST', '/api/workspaces', {
      cookie,
      origin: t.url,
      body: { name: 'Mine' },
    });
    expect(sameOrigin.status).toBe(201);
  });

  it('serves the web app with a CSP, SPA routes and no path traversal', async () => {
    const t = await startTestServer();
    servers.push(t);
    await t.stop();
    const web = path.join(t.dataDir, 'web');
    mkdirSync(path.join(web, 'assets'), { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>Tessera</title>');
    writeFileSync(path.join(web, 'assets', 'app-abc123.js'), 'console.log(1)');
    writeFileSync(path.join(t.dataDir, 'secret.txt'), 'top secret');
    const withWeb = await server({ webDir: web }, {}, undefined);
    const index = await fetch(`${withWeb.url}/p/some-page`);
    expect(index.status).toBe(200);
    expect(await index.text()).toContain('<title>Tessera</title>');
    expect(index.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(index.headers.get('cache-control')).toBe('no-cache');
    const asset = await fetch(`${withWeb.url}/assets/app-abc123.js`);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    for (const attempt of [
      '/../secret.txt',
      '/%2e%2e/secret.txt',
      '/assets/..%2f..%2fsecret.txt',
      '/..%5csecret.txt',
    ]) {
      const response = await fetch(`${withWeb.url}${attempt}`);
      expect(await response.text()).not.toContain('top secret');
    }
    expect((await fetch(`${withWeb.url}/missing.js`)).status).toBe(404);
    expect((await fetch(`${withWeb.url}/api/nope`)).status).toBe(404);
  });
});
