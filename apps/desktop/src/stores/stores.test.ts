import { readDocJSON, writeDocJSON, type WorkspaceInfo } from '@tessera/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { TauriBackend } from '../backend/tauri-backend';
import { cleanupDesktop, desktopTestContext } from '../testing/context';
import { fakeTauri, installFakeTauri } from '../testing/fake-tauri';
import { TauriAssetStore } from './asset-store';
import { TauriDocStore } from './doc-store';
import { TauriWorkspaceRegistry } from './workspace-registry';

const WORKSPACE: WorkspaceInfo = {
  id: 'ws_apollo',
  name: 'Apollo research',
  path: '/home/ada/Tessera/Apollo research',
  createdAt: 1,
};

afterEach(cleanupDesktop);

describe('TauriDocStore', () => {
  beforeEach(() => installFakeTauri({ home: '/home/ada', os: 'linux' }));

  it('persists updates and merges them on load', async () => {
    const store = await TauriDocStore.open(new TauriBackend(), WORKSPACE);
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array) => void store.storeUpdate('page:a', update));
    doc.getText('t').insert(0, 'Hello');
    doc.getText('t').insert(5, ' world');
    await store.flush();
    const state = await store.load('page:a');
    const copy = new Y.Doc();
    Y.applyUpdate(copy, state ?? new Uint8Array());
    expect(copy.getText('t').toString()).toBe('Hello world');
    expect(await store.load('page:missing')).toBeNull();
    expect(await store.list('page:')).toEqual(['page:a']);
    await store.delete('page:a');
    expect(await store.load('page:a')).toBeNull();
  });

  it('creates the folder on the first write only', async () => {
    const store = await TauriDocStore.open(new TauriBackend(), WORKSPACE);
    expect(store.status.exists).toBe(false);
    await store.load('ws:ws_apollo');
    expect(fakeTauri().state.folders[WORKSPACE.path ?? '']).toBeUndefined();
    await store.storeUpdate('ws:ws_apollo', new Uint8Array([0, 0]));
    expect(fakeTauri().state.folders[WORKSPACE.path ?? '']?.workspace?.id).toBe('ws_apollo');
  });

  it('compacts without losing updates stored meanwhile', async () => {
    const store = await TauriDocStore.open(new TauriBackend(), WORKSPACE);
    const doc = new Y.Doc();
    const pending: Array<Promise<void>> = [];
    doc.on('update', (update: Uint8Array) => pending.push(store.storeUpdate('page:a', update)));
    for (const word of ['one', 'two', 'three']) doc.getArray<string>('a').push([word]);
    await Promise.all(pending);
    const compacting = store.compact('page:a');
    doc.getArray<string>('a').push(['four']);
    await Promise.all([compacting, ...pending]);
    const copy = new Y.Doc();
    Y.applyUpdate(copy, (await store.load('page:a')) ?? new Uint8Array());
    expect(copy.getArray<string>('a').toArray()).toEqual(['one', 'two', 'three', 'four']);
    const rows = fakeTauri().state.dbs.ws_apollo?.updates ?? [];
    expect(rows.length).toBeLessThan(4);
  });

  it('applies updates stored by the other window, not its own', async () => {
    const store = await TauriDocStore.open(new TauriBackend(), WORKSPACE);
    const received: number[][] = [];
    const off = store.watch('page:a', (update) => received.push([...update]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const emit = (origin: string, workspaceId = 'ws_apollo', docName = 'page:a') =>
      fakeTauri().emit('desktop://doc-update', { workspaceId, docName, update: 'AQI=', origin });
    emit('capture');
    emit('main');
    emit('capture', 'other');
    emit('capture', 'ws_apollo', 'page:b');
    off();
    emit('capture');
    expect(received).toEqual([[1, 2]]);
  });

  it('flushes pending writes and detaches on dispose', async () => {
    const backend = new TauriBackend();
    const store = await TauriDocStore.open(backend, WORKSPACE);
    void store.storeUpdate('page:a', new Uint8Array([1]));
    await store.dispose();
    await expect(backend.workspaceStatus('ws_apollo')).rejects.toMatchObject({ code: 'not_found' });
    expect(fakeTauri().state.dbs.ws_apollo?.updates).toHaveLength(1);
  });

  it('refuses a workspace without a folder', async () => {
    const { path: _path, ...withoutPath } = WORKSPACE;
    await expect(TauriDocStore.open(new TauriBackend(), withoutPath)).rejects.toThrow(/no folder/);
  });
});

describe('TauriAssetStore', () => {
  beforeEach(() => installFakeTauri({ home: '/home/ada', os: 'linux' }));

  it('stores files by content hash with their metadata', async () => {
    const store = await TauriAssetStore.open(new TauriBackend(), WORKSPACE);
    const file = new File(['moon'], 'moon.png', { type: 'image/png' });
    const first = await store.put(file);
    const second = await store.put(new Blob(['moon']), { name: 'again.png' });
    expect(first.assetId).toMatch(/^[0-9a-f]{64}$/);
    expect(second.assetId).toBe(first.assetId);
    expect(first.url).toBe(new TauriBackend().assetUrl(WORKSPACE.id, first.assetId));
    const info = await store.getInfo(first.assetId);
    expect(info).toMatchObject({ name: 'moon.png', mimeType: 'image/png', size: 4 });
    const blob = await store.get(first.assetId);
    expect(blob?.type).toBe('image/png');
    expect(await blob?.text()).toBe('moon');
    expect(await store.list()).toHaveLength(1);
    expect(await store.getUrl(first.assetId)).toBe(first.url);
    await store.delete(first.assetId);
    expect(await store.get(first.assetId)).toBeNull();
    expect(await store.getUrl(first.assetId)).toBeNull();
    expect(await store.get('../../etc/passwd')).toBeNull();
    await store.dispose();
  });
});

describe('TauriWorkspaceRegistry', () => {
  const setup = (folders = {}) => {
    installFakeTauri({ home: '/home/ada', os: 'linux', folders });
    return new TauriWorkspaceRegistry(new TauriBackend(), { defaultRoot: '/home/ada/Tessera' });
  };

  it('creates workspaces in ~/Tessera by default, with unique folder names', async () => {
    const registry = setup({ '/home/ada/Tessera/Apollo': { entries: 3 } });
    const first = await registry.create({ name: '  Apollo  ' });
    expect(first.name).toBe('Apollo');
    expect(first.path).toBe('/home/ada/Tessera/Apollo 2');
    const second = await registry.create({ name: 'Apollo' });
    expect(second.path).toBe('/home/ada/Tessera/Apollo 3');
    await expect(registry.create({ name: '   ' })).rejects.toThrow(/empty/);
    await expect(registry.create({ name: 'x', id: first.id })).rejects.toThrow(/exists/);
    const all = await registry.listAll();
    expect(all.map((w) => w.status)).toEqual(['new', 'new']);
  });

  it('orders by last opened and hides workspaces whose folder is gone', async () => {
    const registry = setup();
    const a = await registry.create({ name: 'A' });
    const b = await registry.create({ name: 'B' });
    await registry.open(a.id);
    expect((await registry.list()).map((w) => w.name)).toEqual(['A', 'B']);
    // B's folder existed once, then disappeared (an unplugged drive).
    const entry = fakeTauri().state.registry.find((e) => e.id === b.id);
    if (entry) entry.initializedAt = 5;
    fakeTauri().save();
    expect((await registry.list()).map((w) => w.name)).toEqual(['A']);
    expect(await registry.get(b.id)).toBeNull();
    expect((await registry.listAll()).find((w) => w.id === b.id)?.status).toBe('missing');
  });

  it('opens a folder that holds a workspace, and makes other folders new workspaces', async () => {
    const registry = setup({
      '/data/Notes': {
        workspace: { id: 'ws_notes', name: 'Team notes', createdAt: 7, formatVersion: 1 },
      },
      '/data/Empty': { entries: 0 },
    });
    const backend = new TauriBackend();
    const opened = await registry.openFolder(await backend.inspectFolder('/data/Notes'));
    expect(opened).toMatchObject({
      kind: 'opened',
      workspace: { id: 'ws_notes', name: 'Team notes' },
    });
    const again = await registry.openFolder(await backend.inspectFolder('/data/Notes'));
    expect(again.workspace.id).toBe('ws_notes');
    const created = await registry.openFolder(await backend.inspectFolder('/data/Empty'));
    expect(created).toMatchObject({
      kind: 'created',
      workspace: { name: 'Empty', path: '/data/Empty' },
    });
    await expect(registry.create({ name: 'Other', path: '/data/Notes' })).rejects.toThrow(
      /already holds/,
    );
  });

  it('follows a moved folder', async () => {
    const registry = setup({
      '/mnt/usb/Notes': {
        workspace: { id: 'ws_notes', name: 'Notes', createdAt: 1, formatVersion: 1 },
      },
    });
    await registry.openFolder(await new TauriBackend().inspectFolder('/mnt/usb/Notes'));
    fakeTauri().addFolder('/home/ada/Notes', {
      workspace: { id: 'ws_notes', name: 'Notes', createdAt: 1, formatVersion: 1 },
    });
    const moved = await registry.locate(
      'ws_notes',
      await new TauriBackend().inspectFolder('/home/ada/Notes'),
    );
    expect(moved.path).toBe('/home/ada/Notes');
    await expect(
      registry.locate('ws_notes', await new TauriBackend().inspectFolder('/mnt/usb/Other')),
    ).rejects.toThrow(/doesn't hold/);
  });

  it('notifies subscribers of its own and other windows’ changes', async () => {
    const registry = setup();
    const seen: string[][] = [];
    registry.subscribe((list) => seen.push(list.map((w) => w.name)));
    await registry.create({ name: 'A' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    fakeTauri().emit('desktop://registry-changed', { origin: 'capture' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual([['A'], ['A']]);
    await registry.rename((await registry.list())[0]?.id ?? '', 'Renamed');
    expect((await registry.list())[0]?.name).toBe('Renamed');
    await registry.remove((await registry.list())[0]?.id ?? '');
    expect(await registry.list()).toEqual([]);
    registry.dispose();
  });
});

describe('the desktop feature in a workspace session', () => {
  it('keeps pages and content in the workspace folder across sessions', async () => {
    const first = await desktopTestContext({ home: '/home/ada', os: 'linux', persist: true });
    expect(first.ctx.serviceSources).toMatchObject({
      workspaceRegistry: 'tauri-folders',
      docStore: 'tauri-sqlite',
      assetStore: 'tauri-files',
    });
    expect(first.workspace.path).toBe('/home/ada/Tessera/Apollo research');
    const page = first.ctx.workspace.createPage({ title: 'Launch plan' });
    const handle = await first.ctx.loadPageDoc(page.id);
    writeDocJSON(handle.doc, {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'T-minus ten' }] }],
    });
    handle.release();
    await first.flush();
    const workspace = first.workspace;
    await first.session.close();

    // A new session (a restart) reads everything back from the folder.
    const session = await first.runtime.openWorkspace(workspace, first.shell);
    expect(session.ctx.workspace.getPage(page.id)?.title).toBe('Launch plan');
    const reopened = await session.ctx.loadPageDoc(page.id);
    expect(JSON.stringify(readDocJSON(reopened.doc))).toContain('T-minus ten');
    reopened.release();
    await session.close();
    await first.runtime.dispose();
  });
});
