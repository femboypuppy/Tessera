import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';
import {
  addMember,
  bootstrap,
  connectClient,
  eventually,
  signUp,
  startTestServer,
  testClock,
  type SyncClient,
  type TestServer,
  cleanupServers,
} from '../testing/harness';

const servers: TestServer[] = [];
const clients: SyncClient[] = [];

async function server(...args: Parameters<typeof startTestServer>): Promise<TestServer> {
  const t = await startTestServer(...args);
  servers.push(t);
  return t;
}

function client(...args: Parameters<typeof connectClient>): SyncClient {
  const c = connectClient(...args);
  clients.push(c);
  return c;
}

afterEach(async () => {
  for (const c of clients.splice(0)) c.destroy();
  await cleanupServers(servers);
});

const text = (doc: Y.Doc) => doc.getText('t').toString();

describe('sync persistence', () => {
  it('syncs two clients and keeps every acknowledged update across a restart', async () => {
    let t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const name = `${workspaceId}/page:launch`;
    const a = client(t.wsUrl, name, ownerToken);
    const b = client(t.wsUrl, name, ownerToken);
    await Promise.all([a.synced(), b.synced()]);
    a.doc.getText('t').insert(0, 'T-minus ');
    b.doc.getText('t').insert(0, '10… ');
    await eventually(() => expect(text(a.doc)).toBe(text(b.doc)));
    await Promise.all([a.settled(), b.settled()]);
    const before = text(a.doc);
    expect(before).toContain('T-minus');
    a.destroy();
    b.destroy();

    t = await t.restart();
    servers.push(t);
    const reader = client(t.wsUrl, name, ownerToken);
    await reader.synced();
    expect(text(reader.doc)).toBe(before);
  });

  it('stores an update before acknowledging it', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const c = client(t.wsUrl, `${workspaceId}/page:ack`, ownerToken);
    await c.synced();
    c.doc.getText('t').insert(0, 'durable');
    await c.settled();
    // Read straight from SQLite: the acknowledged update is there.
    const stored = t.server.services.persistence.load(workspaceId, 'page:ack');
    const doc = new Y.Doc();
    if (stored) Y.applyUpdate(doc, stored);
    expect(text(doc)).toBe('durable');
  });

  it('lists docs with sequence numbers that move on changes', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const c = client(t.wsUrl, `${workspaceId}/page:seq`, ownerToken);
    await c.synced();
    c.doc.getText('t').insert(0, 'one');
    await c.settled();
    const first = await t.api<{ docs: Array<{ name: string; seq: number }> }>(
      'GET',
      `/api/workspaces/${workspaceId}/docs`,
      {
        token: ownerToken,
      },
    );
    const seq = first.body.docs.find((doc) => doc.name === 'page:seq')?.seq ?? 0;
    expect(seq).toBeGreaterThan(0);
    c.doc.getText('t').insert(3, ' two');
    await c.settled();
    const second = await t.api<{ docs: Array<{ name: string; seq: number }> }>(
      'GET',
      `/api/workspaces/${workspaceId}/docs`,
      {
        token: ownerToken,
      },
    );
    expect(second.body.docs.find((doc) => doc.name === 'page:seq')?.seq).toBeGreaterThan(seq);
  });
});

describe('sync authorization', () => {
  it('rejects unauthenticated connections and sends them nothing', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const owner = client(t.wsUrl, `${workspaceId}/page:secret`, ownerToken);
    await owner.synced();
    owner.doc.getText('t').insert(0, 'classified');
    await owner.settled();
    const intruder = client(t.wsUrl, `${workspaceId}/page:secret`, '');
    expect(await intruder.authFailure).toBe('unauthenticated');
    const forged = client(t.wsUrl, `${workspaceId}/page:secret`, 'forged-token-value');
    expect(await forged.authFailure).toBe('unauthenticated');
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(text(intruder.doc)).toBe('');
    expect(text(forged.doc)).toBe('');
  });

  it('rejects non-members, other workspaces and malformed document names', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const stranger = await signUp(t, 'stranger@example.com');
    const theirs = await t.api<{ workspace: { id: string } }>('POST', '/api/workspaces', {
      token: stranger.token,
      body: { name: 'Stranger things' },
    });
    expect(await client(t.wsUrl, `${workspaceId}/page:x`, stranger.token).authFailure).toBe(
      'forbidden',
    );
    expect(
      await client(t.wsUrl, `${theirs.body.workspace.id}/page:x`, ownerToken).authFailure,
    ).toBe('forbidden');
    expect(await client(t.wsUrl, `page:x`, ownerToken).authFailure).toBe('invalid-document');
    expect(await client(t.wsUrl, `${workspaceId}/ws:someone-else`, ownerToken).authFailure).toBe(
      'invalid-document',
    );
    expect(await client(t.wsUrl, `${workspaceId}/../page:x`, ownerToken).authFailure).toBe(
      'invalid-document',
    );
  });

  it('gives viewers read-only connections: their edits never reach the server', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const viewer = await addMember(t, ownerToken, workspaceId, 'viewer@example.com', 'viewer');
    const name = `${workspaceId}/page:plan`;
    const owner = client(t.wsUrl, name, ownerToken);
    await owner.synced();
    owner.doc.getText('t').insert(0, 'owner text');
    await owner.settled();
    const view = client(t.wsUrl, name, viewer.token);
    await view.synced();
    expect(text(view.doc)).toBe('owner text');
    view.doc.getText('t').insert(0, 'VANDALISM ');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(text(owner.doc)).toBe('owner text');
    const stored = new Y.Doc();
    const state = t.server.services.persistence.load(workspaceId, 'page:plan');
    if (state) Y.applyUpdate(stored, state);
    expect(text(stored)).toBe('owner text');
    // Reads keep working.
    owner.doc.getText('t').insert(10, '!');
    await eventually(() => expect(text(view.doc)).toContain('owner text!'));
  });

  it('refuses hand-crafted update messages from a viewer', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const viewer = await addMember(t, ownerToken, workspaceId, 'viewer@example.com', 'viewer');
    const docName = `${workspaceId}/page:crafted`;
    const owner = client(t.wsUrl, docName, ownerToken);
    await owner.synced();
    owner.doc.getText('t').insert(0, 'original');
    await owner.settled();

    const socket = new WebSocket(t.wsUrl);
    const replies: Array<{ type: number; data: decoding.Decoder }> = [];
    socket.on('message', (data: Buffer) => {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      decoding.readVarString(decoder);
      replies.push({ type: decoding.readVarUint(decoder), data: decoder });
    });
    await new Promise((resolve) => socket.once('open', resolve));
    const send = (write: (encoder: encoding.Encoder) => void) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarString(encoder, docName);
      write(encoder);
      socket.send(encoding.toUint8Array(encoder));
    };
    send((e) => {
      encoding.writeVarUint(e, 2); // Auth
      encoding.writeVarUint(e, 0); // Token
      encoding.writeVarString(e, viewer.token);
    });
    await eventually(() => expect(replies.some((reply) => reply.type === 2)).toBe(true));
    const attacker = new Y.Doc();
    attacker.getText('t').insert(0, 'PWNED ');
    const update = Y.encodeStateAsUpdate(attacker);
    send((e) => {
      encoding.writeVarUint(e, 0); // Sync
      encoding.writeVarUint(e, 2); // Update
      encoding.writeVarUint8Array(e, update);
    });
    send((e) => {
      encoding.writeVarUint(e, 0); // Sync
      encoding.writeVarUint(e, 1); // SyncStep2
      encoding.writeVarUint8Array(e, update);
    });
    await eventually(() => expect(replies.filter((reply) => reply.type === 8)).toHaveLength(2));
    const statuses = replies
      .filter((reply) => reply.type === 8)
      .map((reply) => decoding.readVarInt(reply.data));
    expect(statuses).toEqual([0, 0]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(text(owner.doc)).toBe('original');
    const stored = new Y.Doc();
    const state = t.server.services.persistence.load(workspaceId, 'page:crafted');
    if (state) Y.applyUpdate(stored, state);
    expect(text(stored)).toBe('original');
    socket.close();
  });

  it('rejects expired sessions, also on an open connection', async () => {
    const clock = testClock();
    const t = await server({ sessionDays: 1 }, { now: clock.now });
    const { ownerToken, workspaceId } = await bootstrap(t);
    const name = `${workspaceId}/page:expiry`;
    const c = client(t.wsUrl, name, ownerToken);
    await c.synced();
    const closed = new Promise<number>((resolve) =>
      c.socket.on('close', ({ event }: { event: { code: number } }) => resolve(event.code)),
    );
    clock.advance(2 * 24 * 60 * 60 * 1000);
    c.doc.getText('t').insert(0, 'too late');
    expect(await closed).toBe(4401);
    expect(t.server.services.persistence.load(workspaceId, 'page:expiry')).toBeNull();
    expect(await client(t.wsUrl, name, ownerToken).authFailure).toBe('unauthenticated');
  });

  it('closes the sockets of a revoked session at once', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await t.api<{ token: string; session: { id: string } }>(
      'POST',
      '/api/auth/login',
      {
        body: { email: 'ada@example.com', password: 'correct horse battery', client: 'desktop' },
      },
    );
    const c = client(t.wsUrl, `${workspaceId}/page:x`, laptop.body.token);
    await c.synced();
    const closed = new Promise<number>((resolve) =>
      c.socket.on('close', ({ event }: { event: { code: number } }) => resolve(event.code)),
    );
    await t.api('DELETE', `/api/auth/sessions/${laptop.body.session.id}`, { token: ownerToken });
    expect(await closed).toBe(4401);
  });

  it('reconnects a demoted editor as read-only', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const editor = await addMember(t, ownerToken, workspaceId, 'ed@example.com', 'editor');
    const name = `${workspaceId}/page:roles`;
    const ed = client(t.wsUrl, name, editor.token);
    await ed.synced();
    ed.doc.getText('t').insert(0, 'allowed ');
    await ed.settled();
    const closed = new Promise<number>((resolve) =>
      ed.socket.on('close', ({ event }: { event: { code: number } }) => resolve(event.code)),
    );
    await t.api('PATCH', `/api/workspaces/${workspaceId}/members/${editor.userId}`, {
      token: ownerToken,
      body: { role: 'viewer' },
    });
    expect(await closed).toBe(4403);
    await eventually(() => expect(ed.provider.authorizedScope).toBe('readonly'), 5000);
    ed.doc.getText('t').insert(0, 'not allowed ');
    await new Promise((resolve) => setTimeout(resolve, 200));
    const stored = new Y.Doc();
    const state = t.server.services.persistence.load(workspaceId, 'page:roles');
    if (state) Y.applyUpdate(stored, state);
    expect(text(stored)).toBe('allowed ');
  });

  it('accepts the session cookie from allowed origins only', async () => {
    const t = await server({ corsOrigins: ['http://localhost:5173'] });
    const { workspaceId } = await bootstrap(t);
    const login = await t.api('POST', '/api/auth/login', {
      body: { email: 'ada@example.com', password: 'correct horse battery' },
    });
    const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
    const tryOrigin = (origin: string) =>
      new Promise<{ opened: boolean; status?: number }>((resolve) => {
        const socket = new WebSocket(t.wsUrl, { headers: { cookie, origin } });
        socket.on('open', () => {
          socket.close();
          resolve({ opened: true });
        });
        socket.on('unexpected-response', (request, response) => {
          response.on('error', () => undefined);
          response.resume();
          request.destroy();
          resolve({ opened: false, status: response.statusCode });
        });
        socket.on('error', () => resolve({ opened: false }));
      });
    expect(await tryOrigin('https://evil.example')).toEqual({ opened: false, status: 403 });
    expect((await tryOrigin('http://localhost:5173')).opened).toBe(true);

    // A cookie-authenticated provider from an allowed origin syncs.
    const polyfill = class extends WebSocket {
      constructor(address: string) {
        super(address, { headers: { cookie, origin: 'http://localhost:5173' } });
      }
    };
    const { HocuspocusProvider, HocuspocusProviderWebsocket } =
      await import('@hocuspocus/provider');
    const socket = new HocuspocusProviderWebsocket({ url: t.wsUrl, WebSocketPolyfill: polyfill });
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      name: `${workspaceId}/page:cookie`,
      document: doc,
      token: '',
      websocketProvider: socket,
    });
    provider.attach();
    await new Promise<void>((resolve) => provider.on('synced', () => resolve()));
    expect(provider.isAuthenticated).toBe(true);
    provider.destroy();
    socket.destroy();
  });

  it('shows the authenticated identity in presence, whatever the client claims', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const editor = await addMember(t, ownerToken, workspaceId, 'mal@example.com', 'editor');
    const name = `${workspaceId}/page:presence`;
    const honest = client(t.wsUrl, name, ownerToken);
    const sneaky = client(t.wsUrl, name, editor.token);
    await Promise.all([honest.synced(), sneaky.synced()]);
    sneaky.provider.setAwarenessField('user', {
      id: 'someone-else',
      name: 'Ada Owner',
      color: '#ff0000',
    });
    await eventually(() => {
      const states = [...(honest.provider.awareness?.getStates().values() ?? [])];
      const theirs = states.find(
        (state) => (state as { user?: { color?: string } }).user?.color === '#ff0000',
      ) as { user: { id: string; name: string } } | undefined;
      expect(theirs?.user).toEqual({ id: editor.userId, name: 'mal', color: '#ff0000' });
    });
  });

  it('disconnects editors of a deleted doc and never lets it come back', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const name = `${workspaceId}/page:doomed`;
    const c = client(t.wsUrl, name, ownerToken);
    await c.synced();
    c.doc.getText('t').insert(0, 'going away');
    await c.settled();
    const removed = await t.api('DELETE', `/api/workspaces/${workspaceId}/docs/page:doomed`, {
      token: ownerToken,
    });
    expect(removed.status).toBe(204);
    expect(t.server.services.persistence.load(workspaceId, 'page:doomed')).toBeNull();
    expect(await client(t.wsUrl, name, ownerToken).authFailure).toBe('document-deleted');
    const docs = await t.api<{ docs: Array<{ name: string }> }>(
      'GET',
      `/api/workspaces/${workspaceId}/docs`,
      { token: ownerToken },
    );
    expect(docs.body.docs.map((doc) => doc.name)).not.toContain('page:doomed');
  });
});
