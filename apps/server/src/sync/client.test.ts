import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createDevice, type Device } from '../testing/devices';
import {
  bootstrap,
  cleanupServers,
  eventually,
  startTestServer,
  type TestServer,
} from '../testing/harness';

const servers: TestServer[] = [];
const devices: Device[] = [];

async function server(): Promise<TestServer> {
  const t = await startTestServer();
  servers.push(t);
  return t;
}

async function device(...args: Parameters<typeof createDevice>): Promise<Device> {
  const d = await createDevice(...args);
  devices.push(d);
  return d;
}

afterEach(async () => {
  for (const d of devices.splice(0)) await d.dispose();
  await cleanupServers(servers);
});

const text = (doc: Y.Doc) => doc.getText('t').toString();

async function storedText(d: Device, docName: string): Promise<string> {
  const doc = new Y.Doc();
  const state = await d.store.load(docName);
  if (state) Y.applyUpdate(doc, state);
  return text(doc);
}

describe('HocuspocusSyncProvider with the runtime DocManager', () => {
  it('syncs an open page between two devices and reports synced', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    const phone = await device(t, { name: 'phone', token: ownerToken, workspaceId });
    const a = await laptop.open('page:plan');
    const b = await phone.open('page:plan');
    a.doc.getText('t').insert(0, 'Launch at dawn');
    await eventually(() => expect(text(b.doc)).toBe('Launch at dawn'));
    await laptop.settled();
    expect(laptop.provider.getStatus()).toMatchObject({ status: 'synced', serverUrl: t.url });
    expect(a.sync?.getStatus().status).toBe('synced');
    a.release();
    b.release();
  });

  it('shares presence through awareness, never through the document', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    const phone = await device(t, { name: 'phone', token: ownerToken, workspaceId });
    const a = await laptop.open('page:presence');
    const b = await phone.open('page:presence');
    a.sync?.awareness.setLocalStateField('cursor', { anchor: 1, head: 3 });
    await eventually(() => {
      const states = [...(b.sync?.awareness.getStates().values() ?? [])] as Array<{
        user?: { name: string };
        cursor?: unknown;
      }>;
      expect(
        states.some((state) => state.cursor !== undefined && state.user?.name === 'Ada Owner'),
      ).toBe(true);
    });
    // Nothing about presence was stored.
    expect(t.server.services.persistence.load(workspaceId, 'page:presence')).toBeNull();
    a.release();
    b.release();
  });

  it('keeps editing offline and syncs on reconnect, with nothing lost or duplicated', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    const phone = await device(t, { name: 'phone', token: ownerToken, workspaceId });
    const a = await laptop.open('page:notes');
    const b = await phone.open('page:notes');
    a.doc.getText('t').insert(0, 'shared ');
    await eventually(() => expect(text(b.doc)).toBe('shared '));

    laptop.goOffline();
    await eventually(() => expect(laptop.provider.getStatus().status).toBe('offline'));
    a.doc.getText('t').insert(a.doc.getText('t').length, 'offline-edit ');
    b.doc.getText('t').insert(0, 'phone-edit ');
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(text(b.doc)).not.toContain('offline-edit');
    expect(laptop.provider.getStatus().pendingUpdates).toBeGreaterThan(0);

    laptop.goOnline();
    await eventually(() => expect(text(a.doc)).toBe(text(b.doc)));
    await Promise.all([laptop.settled(), phone.settled()]);
    const final = text(a.doc);
    expect(final.match(/offline-edit/g)).toHaveLength(1);
    expect(final.match(/phone-edit/g)).toHaveLength(1);
    expect(final.match(/shared/g)).toHaveLength(1);
    const onServer = new Y.Doc();
    const state = t.server.services.persistence.load(workspaceId, 'page:notes');
    if (state) Y.applyUpdate(onServer, state);
    expect(text(onServer)).toBe(final);
    a.release();
    b.release();
  });

  it('pushes edits made offline to pages that were closed before the connection came back', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    laptop.goOffline();
    const page = await laptop.open('page:closed');
    page.doc.getText('t').insert(0, 'written on the plane');
    await laptop.manager.flush();
    page.release();
    await laptop.manager.flush();
    expect(laptop.provider.isOpen('page:closed')).toBe(false);
    expect((await laptop.syncState.get('page:closed'))?.dirty).toBe(true);

    laptop.goOnline();
    await eventually(() => {
      const state = t.server.services.persistence.load(workspaceId, 'page:closed');
      const doc = new Y.Doc();
      if (state) Y.applyUpdate(doc, state);
      expect(text(doc)).toBe('written on the plane');
    }, 10_000);
    await laptop.settled();
    await eventually(async () =>
      expect((await laptop.syncState.get('page:closed'))?.dirty).toBe(false),
    );
  });

  it('pulls docs changed on the server so they are available offline', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    const page = await laptop.open('page:shared');
    page.doc.getText('t').insert(0, 'written on the laptop');
    await laptop.settled();
    page.release();

    // The phone never opens the page, yet has it afterwards.
    const phone = await device(t, { name: 'phone', token: ownerToken, workspaceId });
    await eventually(
      async () => expect(await storedText(phone, 'page:shared')).toBe('written on the laptop'),
      10_000,
    );
    await phone.settled();
    phone.goOffline();
    const offlineCopy = await phone.open('page:shared');
    expect(text(offlineCopy.doc)).toBe('written on the laptop');
    offlineCopy.release();
  });

  it('survives a server restart: clients reconnect on their own', async () => {
    let t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const port = t.server.port;
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    const a = await laptop.open('page:restart');
    a.doc.getText('t').insert(0, 'before ');
    await laptop.settled();
    await t.stop();
    await eventually(() => expect(laptop.provider.getStatus().status).toBe('offline'));
    a.doc.getText('t').insert(7, 'during ');
    t = await startTestServer({ port }, {}, t.dataDir);
    servers.push(t);
    await laptop.settled(15_000);
    const doc = new Y.Doc();
    const state = t.server.services.persistence.load(workspaceId, 'page:restart');
    if (state) Y.applyUpdate(doc, state);
    expect(text(doc)).toBe('before during ');
    a.release();
  });

  it('reports errors when the server refuses the workspace', async () => {
    const t = await server();
    const { workspaceId } = await bootstrap(t);
    const stranger = await device(t, { name: 'stranger', token: 'not-a-session', workspaceId });
    await eventually(() =>
      expect(stranger.provider.getStatus()).toMatchObject({
        status: 'error',
        error: { code: 'unauthenticated' },
      }),
    );
  });

  it('sends queued deletions once back online', async () => {
    const t = await server();
    const { ownerToken, workspaceId } = await bootstrap(t);
    const laptop = await device(t, { name: 'laptop', token: ownerToken, workspaceId });
    const page = await laptop.open('page:doomed');
    page.doc.getText('t').insert(0, 'temporary');
    await laptop.settled();
    page.release();
    laptop.goOffline();
    await laptop.syncState.enqueue({ kind: 'deleteDoc', docName: 'page:doomed' });
    laptop.goOnline();
    await eventually(
      () => expect(t.server.services.persistence.isDeleted(workspaceId, 'page:doomed')).toBe(true),
      10_000,
    );
    await eventually(async () => expect(await laptop.syncState.outbox()).toEqual([]));
  });
});
