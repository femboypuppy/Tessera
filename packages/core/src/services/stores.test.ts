import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { NotFoundError, ValidationError } from '../errors';
import { MemoryAssetStore, MemoryAssetBackend, sha256Hex } from './asset-store';
import { MemoryDocStore, MemoryDocStoreBackend } from './doc-store';
import { LocalSyncProvider } from './sync-provider';
import { MemoryWorkspaceRegistry } from './workspace-registry';

describe('MemoryDocStore', () => {
  it('stores updates, loads them merged, compacts without losing content, lists and deletes', async () => {
    const store = new MemoryDocStore();
    expect(await store.load('page:a')).toBeNull();
    const doc = new Y.Doc();
    doc.on('update', (update: Uint8Array) => void store.storeUpdate('page:a', update));
    const text = doc.getText('t');
    for (const word of ['one ', 'two ', 'three']) text.insert(text.length, word);
    text.delete(0, 4);
    expect(store.updateCount('page:a')).toBe(4);
    const loaded = new Y.Doc();
    Y.applyUpdate(loaded, (await store.load('page:a')) ?? new Uint8Array());
    expect(loaded.getText('t').toString()).toBe('two three');
    await store.compact('page:a');
    expect(store.updateCount('page:a')).toBe(1);
    const compacted = new Y.Doc();
    Y.applyUpdate(compacted, (await store.load('page:a')) ?? new Uint8Array());
    expect(compacted.getText('t').toString()).toBe('two three');
    // A client that still has the pre-compaction history can keep syncing.
    text.insert(0, 'zero ');
    Y.applyUpdate(compacted, (await store.load('page:a')) ?? new Uint8Array());
    expect(compacted.getText('t').toString()).toBe('zero two three');
    await store.storeUpdate('db:b', Y.encodeStateAsUpdate(new Y.Doc()));
    expect(await store.list()).toEqual(['db:b', 'page:a']);
    expect(await store.list('page:')).toEqual(['page:a']);
    await store.delete('page:a');
    expect(await store.list()).toEqual(['db:b']);
    await store.flush();
  });

  it('notifies other instances on the same backend, like browser tabs', async () => {
    const backend = new MemoryDocStoreBackend();
    const tabA = new MemoryDocStore(backend);
    const tabB = new MemoryDocStore(backend);
    const seenByB = vi.fn();
    const seenByA = vi.fn();
    const stopB = tabB.watch('page:x', seenByB);
    tabA.watch('page:x', seenByA);
    await tabA.storeUpdate('page:x', new Uint8Array([1, 2, 3]));
    expect(seenByB).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(seenByA).not.toHaveBeenCalled();
    stopB();
    await tabA.storeUpdate('page:x', new Uint8Array([4]));
    expect(seenByB).toHaveBeenCalledTimes(1);
  });
});

describe('MemoryAssetStore', () => {
  it('stores content-addressed blobs with metadata and URLs', async () => {
    const backend = new MemoryAssetBackend();
    const store = new MemoryAssetStore(backend);
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    const first = await store.put(blob, { name: 'hello.txt' });
    const second = await store.put(new Blob(['hello world'], { type: 'text/plain' }));
    expect(first.assetId).toBe(await sha256Hex(blob));
    expect(first.assetId).toMatch(/^[0-9a-f]{64}$/);
    expect(second.assetId).toBe(first.assetId);
    expect(first.url).toBe(second.url);
    expect(await store.getUrl(first.assetId)).toBe(first.url);
    expect(await (await store.get(first.assetId))?.text()).toBe('hello world');
    expect(await store.getInfo(first.assetId)).toMatchObject({
      name: 'hello.txt',
      mimeType: 'text/plain',
      size: 11,
    });
    expect(await store.list()).toHaveLength(1);
    // A new store over the same backend (the workspace reopened) still has the asset.
    expect(await new MemoryAssetStore(backend).get(first.assetId)).not.toBeNull();
    await store.delete(first.assetId);
    expect(await store.get(first.assetId)).toBeNull();
    expect(await store.getUrl(first.assetId)).toBeNull();
    expect(await store.getInfo('missing')).toBeNull();
    store.dispose();
  });
});

describe('LocalSyncProvider', () => {
  it('reports local status and provides a working awareness', async () => {
    const provider = new LocalSyncProvider();
    const doc = new Y.Doc();
    const handle = provider.connect('page:a', doc);
    expect(provider.getStatus()).toEqual({ status: 'local' });
    expect(handle.getStatus().status).toBe('local');
    await expect(handle.whenSynced()).resolves.toBeUndefined();
    handle.awareness.setLocalStateField('user', { name: 'Ada' });
    expect(handle.awareness.getLocalState()).toEqual({ user: { name: 'Ada' } });
    const off = handle.onStatus(() => undefined);
    off();
    provider.onStatus(() => undefined)();
    handle.destroy();
    handle.destroy();
  });
});

describe('MemoryWorkspaceRegistry', () => {
  it('creates, orders, opens, renames, updates and removes workspaces', async () => {
    let now = 1000;
    const removed: string[] = [];
    const registry = new MemoryWorkspaceRegistry({
      now: () => now,
      onRemove: (id) => removed.push(id),
    });
    const lists: number[] = [];
    registry.subscribe((list) => lists.push(list.length));
    const personal = await registry.create({ name: '  Personal  ', icon: '🏡' });
    now = 2000;
    const work = await registry.create({ name: 'Work', serverUrl: 'https://tessera.example.com' });
    expect(personal).toMatchObject({ name: 'Personal', icon: '🏡', createdAt: 1000 });
    expect((await registry.list()).map((w) => w.name)).toEqual(['Work', 'Personal']);
    await registry.open(personal.id);
    expect((await registry.list()).map((w) => w.name)).toEqual(['Personal', 'Work']);
    await registry.open(work.id);
    expect((await registry.list())[0]?.id).toBe(work.id);
    await registry.rename(work.id, 'Team');
    expect(await registry.update(work.id, { serverUrl: null })).toMatchObject({
      name: 'Team',
      serverUrl: null,
    });
    await expect(registry.rename(work.id, '   ')).rejects.toThrow(ValidationError);
    await registry.remove(personal.id);
    expect(removed).toEqual([personal.id]);
    expect(await registry.get(personal.id)).toBeNull();
    await expect(registry.open(personal.id)).rejects.toThrow(NotFoundError);
    await expect(registry.create({ name: 'x', id: work.id })).rejects.toThrow(ValidationError);
    expect(lists.length).toBeGreaterThanOrEqual(6);
  });
});
