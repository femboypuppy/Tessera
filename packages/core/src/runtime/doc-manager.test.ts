import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { MemoryDocStore, MemoryDocStoreBackend, type DocStore } from '../services/doc-store';
import { LocalSyncProvider } from '../services/sync-provider';
import { DocManager, STORE_ORIGIN, type DocUpdateEvent } from './doc-manager';

const user = { id: 'u1', name: 'Ada', color: '#0090ff' };

function manager(
  store: DocStore = new MemoryDocStore(),
  extra: Partial<ConstructorParameters<typeof DocManager>[0]> = {},
) {
  return new DocManager({
    docStore: store,
    syncProvider: new LocalSyncProvider(),
    getUser: () => user,
    releaseDelayMs: 0,
    ...extra,
  });
}

afterEach(() => vi.useRealTimers());

describe('DocManager', () => {
  it('shares one doc between leases and closes it after the last release', async () => {
    const docs = manager();
    const a = docs.acquirePageDoc('p1');
    const b = docs.acquirePageDoc('p1');
    expect(a.doc).toBe(b.doc);
    expect(a.docName).toBe('page:p1');
    expect(a.kind).toBe('page');
    expect(a.id).toBe('p1');
    await a.whenLoaded;
    expect(a.isLoaded).toBe(true);
    expect(a.sync?.awareness.getLocalState()).toEqual({
      user: { id: 'u1', name: 'Ada', color: '#0090ff' },
    });
    a.release();
    a.release();
    expect(docs.openDocNames()).toEqual(['page:p1']);
    b.release();
    await docs.flush();
    expect(docs.openDocNames()).toEqual([]);
  });

  it('persists every local update and restores it on reopen', async () => {
    const store = new MemoryDocStore();
    const docs = manager(store);
    const handle = await docs.load('page:p1');
    handle.doc.getText('t').insert(0, 'hello');
    handle.release();
    await docs.flush();
    const reopened = await docs.load('page:p1');
    expect(reopened.doc).not.toBe(handle.doc);
    expect(reopened.doc.getText('t').toString()).toBe('hello');
    reopened.release();
    await docs.dispose();
  });

  it('keeps docs open during the release delay and waits for writes before reopening', async () => {
    vi.useFakeTimers();
    let release: () => void = () => undefined;
    const slowStore = new MemoryDocStore();
    const original = slowStore.storeUpdate.bind(slowStore);
    slowStore.storeUpdate = (name, update) =>
      new Promise<void>((resolve) => {
        release = () => void original(name, update).then(resolve);
      });
    const docs = manager(slowStore, { releaseDelayMs: 1000 });
    const handle = docs.acquirePageDoc('p1');
    await handle.whenLoaded;
    handle.doc.getText('t').insert(0, 'slow');
    handle.release();
    vi.advanceTimersByTime(500);
    const again = docs.acquirePageDoc('p1');
    expect(again.doc).toBe(handle.doc);
    again.release();
    vi.advanceTimersByTime(1000);
    expect(docs.openDocNames()).toEqual([]);
    const reopened = docs.acquirePageDoc('p1');
    vi.useRealTimers();
    release();
    await reopened.whenLoaded;
    expect(reopened.doc.getText('t').toString()).toBe('slow');
    reopened.release();
    await docs.dispose();
  });

  it('reports updates with origin and locality, but not the initial load', async () => {
    const store = new MemoryDocStore();
    const seed = new Y.Doc();
    seed.getText('t').insert(0, 'stored');
    await store.storeUpdate('page:p1', Y.encodeStateAsUpdate(seed));
    const events: DocUpdateEvent[] = [];
    const docs = manager(store, { onDocUpdate: (event) => events.push(event) });
    const handle = await docs.load('page:p1');
    expect(events).toEqual([]);
    handle.doc.getText('t').insert(0, 'x');
    const remote = new Y.Doc();
    remote.getText('other').insert(0, 'remote');
    Y.applyUpdate(handle.doc, Y.encodeStateAsUpdate(remote), 'provider');
    expect(events.map((e) => [e.local, e.origin])).toEqual([
      [true, null],
      [false, 'provider'],
    ]);
    expect(store.updateCount('page:p1')).toBe(3);
    handle.release();
    await docs.dispose();
  });

  it('syncs two managers over one backend like two tabs', async () => {
    const backend = new MemoryDocStoreBackend();
    const tabA = manager(new MemoryDocStore(backend));
    const tabB = manager(new MemoryDocStore(backend));
    const a = await tabA.load('page:shared');
    const b = await tabB.load('page:shared');
    const seenByB: DocUpdateEvent[] = [];
    const docsB = manager(new MemoryDocStore(backend), {
      onDocUpdate: (event) => seenByB.push(event),
    });
    const c = await docsB.load('page:shared');
    a.doc.getText('t').insert(0, 'from A');
    expect(b.doc.getText('t').toString()).toBe('from A');
    expect(c.doc.getText('t').toString()).toBe('from A');
    expect(seenByB).toEqual([expect.objectContaining({ local: false, origin: STORE_ORIGIN })]);
    // Updates received from another tab are not stored again.
    expect(backend.docs.get('page:shared')).toHaveLength(1);
    for (const handle of [a, b, c]) handle.release();
    await Promise.all([tabA.dispose(), tabB.dispose(), docsB.dispose()]);
  });

  it('retries failed writes and never loses them', async () => {
    const store = new MemoryDocStore();
    const onError = vi.fn();
    let fail = true;
    const original = store.storeUpdate.bind(store);
    store.storeUpdate = async (name, update) => {
      if (fail) throw new Error('QuotaExceededError');
      return original(name, update);
    };
    const docs = manager(store, { onError });
    const handle = await docs.load('page:p1');
    handle.doc.getText('t').insert(0, 'one');
    handle.doc.getText('t').insert(3, ' two');
    await docs.flush();
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      docName: 'page:p1',
      operation: 'store',
    });
    fail = false;
    await docs.flush();
    const check = new Y.Doc();
    Y.applyUpdate(check, (await store.load('page:p1')) ?? new Uint8Array());
    expect(check.getText('t').toString()).toBe('one two');
    handle.release();
    await docs.dispose();
  });

  it('surfaces load errors on the handle', async () => {
    const store = new MemoryDocStore();
    store.load = async () => {
      throw new Error('corrupt database');
    };
    const onError = vi.fn();
    const docs = manager(store, { onError });
    const handle = docs.acquirePageDoc('p1');
    await expect(handle.whenLoaded).rejects.toThrow('corrupt database');
    expect(handle.error?.message).toBe('corrupt database');
    expect(handle.isLoaded).toBe(false);
    await expect(docs.load('page:p2')).rejects.toThrow('corrupt database');
    handle.release();
    await docs.dispose();
  });

  it('deletes docs after their pending writes, and compacts busy docs on close', async () => {
    const store = new MemoryDocStore();
    const docs = manager(store, { compactAfterUpdates: 3 });
    const busy = await docs.load('page:busy');
    for (let i = 0; i < 5; i += 1) busy.doc.getText('t').insert(0, String(i));
    busy.release();
    await docs.flush();
    expect(store.updateCount('page:busy')).toBe(1);
    const doomed = await docs.load('page:doomed');
    doomed.doc.getText('t').insert(0, 'bye');
    await docs.deleteDoc('page:doomed');
    expect(await store.list()).toEqual(['page:busy']);
    doomed.doc.getText('t').insert(0, 'ignored');
    await docs.flush();
    expect(await store.list()).toEqual(['page:busy']);
    doomed.release();
    await docs.dispose();
    expect(() => docs.acquirePageDoc('p')).toThrow('closed');
  });

  it('updates presence when the user changes', async () => {
    const docs = manager();
    const handle = await docs.load('db:d1');
    expect(handle.kind).toBe('database');
    docs.setUser({ id: 'u1', name: 'Grace', color: '#e5484d' });
    expect(handle.sync?.awareness.getLocalState()?.user).toEqual({
      id: 'u1',
      name: 'Grace',
      color: '#e5484d',
    });
    handle.release();
    await docs.dispose();
  });
});
