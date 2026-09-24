import { describe, expect, it, vi } from 'vitest';
import { inviteServer, inviteTokenFrom } from '../feature/invite-link';
import { ServerApi, ServerApiError } from './api';
import { normalizeServerUrl, syncSocketUrl } from './server-url';

describe('server URLs', () => {
  it('normalizes what people type', () => {
    expect(normalizeServerUrl('notes.example.com')).toBe('https://notes.example.com');
    expect(normalizeServerUrl('  https://notes.example.com/  ')).toBe('https://notes.example.com');
    expect(normalizeServerUrl('localhost:8787')).toBe('http://localhost:8787');
    expect(normalizeServerUrl('192.168.1.20:8787')).toBe('http://192.168.1.20:8787');
    expect(normalizeServerUrl('nas.local')).toBe('http://nas.local');
    expect(normalizeServerUrl('https://example.com/tessera/')).toBe('https://example.com/tessera');
    expect(normalizeServerUrl('ftp://example.com')).toBeNull();
    expect(normalizeServerUrl('')).toBeNull();
    expect(normalizeServerUrl('http://')).toBeNull();
  });

  it('derives the WebSocket endpoint', () => {
    expect(syncSocketUrl('https://notes.example.com')).toBe('wss://notes.example.com/sync');
    expect(syncSocketUrl('http://localhost:8787')).toBe('ws://localhost:8787/sync');
    expect(syncSocketUrl('https://example.com/tessera')).toBe('wss://example.com/tessera/sync');
  });

  it('reads invite links', () => {
    const link = 'https://notes.example.com/?invite=abcdefghijklmnop_-12';
    expect(inviteTokenFrom(link)).toBe('abcdefghijklmnop_-12');
    expect(inviteServer(link)).toBe('https://notes.example.com');
    expect(inviteTokenFrom('abcdefghijklmnop')).toBe('abcdefghijklmnop');
    expect(inviteTokenFrom('https://example.com/?invite=<script>')).toBeNull();
    expect(inviteTokenFrom('not an invite')).toBeNull();
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('ServerApi', () => {
  it('sends the session cookie in the web app and validates responses', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(200, {
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com', isOwner: true },
        session: {
          id: 's1',
          kind: 'cookie',
          deviceName: null,
          userAgent: null,
          createdAt: 1,
          lastSeenAt: 1,
          expiresAt: 2,
          current: true,
        },
      }),
    );
    const api = new ServerApi('https://notes.example.com', { mode: 'cookie', fetch });
    const me = await api.me();
    expect(me?.user.name).toBe('Ada');
    expect(fetch).toHaveBeenCalledWith(
      'https://notes.example.com/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('uses and stores bearer tokens in the desktop app', async () => {
    let token: string | null = null;
    const fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      const auth = new Headers(init?.headers).get('authorization');
      if (auth) return jsonResponse(200, { workspaces: [] });
      return jsonResponse(201, {
        user: { id: 'u1', name: 'Ada', email: 'ada@example.com', isOwner: false },
        session: {
          id: 's1',
          kind: 'bearer',
          deviceName: null,
          userAgent: null,
          createdAt: 1,
          lastSeenAt: 1,
          expiresAt: 2,
          current: true,
        },
        token: 'secret-token',
      });
    });
    const api = new ServerApi('https://notes.example.com', {
      mode: 'bearer',
      fetch: fetch as unknown as typeof globalThis.fetch,
      getToken: async () => token,
      setToken: async (value) => {
        token = value;
      },
    });
    await api.login({ email: 'ada@example.com', password: 'correct horse' });
    expect(token).toBe('secret-token');
    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as { client: string };
    expect(body.client).toBe('desktop');
    await api.workspaces();
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('authorization')).toBe(
      'Bearer secret-token',
    );
  });

  it('turns failures into clear errors', async () => {
    const unreachable = new ServerApi('https://down.example.com', {
      mode: 'cookie',
      fetch: async () => {
        throw new TypeError('Failed to fetch');
      },
    });
    await expect(unreachable.workspaces()).rejects.toMatchObject({
      status: 0,
      isNetworkError: true,
    });
    const refused = new ServerApi('https://notes.example.com', {
      mode: 'cookie',
      fetch: async () =>
        jsonResponse(403, { error: { code: 'permission_denied', message: 'Nope.' } }),
    });
    await expect(refused.workspaces()).rejects.toMatchObject({
      status: 403,
      code: 'permission_denied',
      message: 'Nope.',
    });
    const garbage = new ServerApi('https://notes.example.com', {
      mode: 'cookie',
      fetch: async () => jsonResponse(200, { workspaces: [{ id: 1 }] }),
    });
    await expect(garbage.workspaces()).rejects.toBeInstanceOf(ServerApiError);
    const proxyPage = new ServerApi('https://notes.example.com', {
      mode: 'cookie',
      fetch: async () => new Response('<html>Bad gateway</html>', { status: 502 }),
    });
    await expect(proxyPage.workspaces()).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });

  it('reports signed-out as null, not an error', async () => {
    const api = new ServerApi('https://notes.example.com', {
      mode: 'cookie',
      fetch: async () =>
        jsonResponse(401, { error: { code: 'unauthenticated', message: 'Sign in.' } }),
    });
    expect(await api.me()).toBeNull();
  });
});
