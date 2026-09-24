import 'fake-indexeddb/auto';
import { ASSET_ID_PATTERN, type AssetInfo } from '@tessera/core';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IndexedDbAssetStore, type RemoteAssets } from './asset-store';

function fakeUrls() {
  let next = 0;
  const live = new Set<string>();
  return {
    live,
    create: vi.fn((_blob: Blob) => {
      next += 1;
      const url = `blob:test/${next}`;
      live.add(url);
      return url;
    }),
    revoke: vi.fn((url: string) => {
      live.delete(url);
    }),
  };
}

const opened: IndexedDbAssetStore[] = [];

async function openStore(
  options: Parameters<typeof IndexedDbAssetStore.open>[1] = {},
): Promise<IndexedDbAssetStore> {
  const store = await IndexedDbAssetStore.open('ws1', { indexedDB: new IDBFactory(), ...options });
  opened.push(store);
  return store;
}

afterEach(() => {
  for (const store of opened.splice(0)) store.dispose();
});

describe('IndexedDbAssetStore', () => {
  it('stores blobs by content hash, once', async () => {
    const urls = fakeUrls();
    const store = await openStore({ urls });
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' });
    const first = await store.put(png, { name: 'moon.png' });
    const second = await store.put(
      new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], { type: 'image/png' }),
      { name: 'copy.png' },
    );
    expect(first.assetId).toMatch(/^[0-9a-f]{64}$/);
    expect(ASSET_ID_PATTERN.test(first.assetId)).toBe(true);
    expect(second.assetId).toBe(first.assetId);
    expect(second.url).toBe(first.url);
    expect(await store.list()).toHaveLength(1);
    const info = await store.getInfo(first.assetId);
    expect(info).toMatchObject({ name: 'moon.png', mimeType: 'image/png', size: 7 });
    const blob = await store.get(first.assetId);
    expect(blob?.type).toBe('image/png');
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array([137, 80, 78, 71, 1, 2, 3]),
    );
  });

  it('returns null for unknown or invalid IDs', async () => {
    const store = await openStore({ urls: fakeUrls() });
    expect(await store.get('0'.repeat(64))).toBeNull();
    expect(await store.getUrl('../../etc/passwd')).toBeNull();
    expect(await store.getInfo('nope')).toBeNull();
  });

  it('persists across sessions', async () => {
    const factory = new IDBFactory();
    const first = await IndexedDbAssetStore.open('ws1', { indexedDB: factory, urls: fakeUrls() });
    const { assetId } = await first.put(new Blob(['hello'], { type: 'text/plain' }));
    first.dispose();
    const second = await IndexedDbAssetStore.open('ws1', { indexedDB: factory, urls: fakeUrls() });
    opened.push(second);
    expect(await (await second.get(assetId))?.text()).toBe('hello');
  });

  it('revokes object URLs on delete and dispose', async () => {
    const urls = fakeUrls();
    const store = await IndexedDbAssetStore.open('ws1', { indexedDB: new IDBFactory(), urls });
    const a = await store.put(new Blob(['a']));
    const b = await store.put(new Blob(['b']));
    expect(urls.live.size).toBe(2);
    await store.delete(a.assetId);
    expect(urls.revoke).toHaveBeenCalledWith(a.url);
    expect(await store.get(a.assetId)).toBeNull();
    store.dispose();
    expect(urls.revoke).toHaveBeenCalledWith(b.url);
    expect(urls.live.size).toBe(0);
  });

  it('revokes leased URLs when the last lease is released', async () => {
    const urls = fakeUrls();
    const factory = new IDBFactory();
    const writer = await IndexedDbAssetStore.open('ws1', { indexedDB: factory, urls: fakeUrls() });
    const { assetId } = await writer.put(new Blob(['thumbnail']));
    writer.dispose();
    const store = await openStore({ indexedDB: factory, urls });
    const lease1 = await store.retainUrl(assetId);
    const lease2 = await store.retainUrl(assetId);
    expect(lease1?.url).toBe(lease2?.url);
    lease1?.release();
    lease1?.release();
    expect(urls.revoke).not.toHaveBeenCalled();
    lease2?.release();
    expect(urls.revoke).toHaveBeenCalledTimes(1);
    expect(urls.live.size).toBe(0);
    // A URL handed out by getUrl lives for the session, even if a lease on it ends.
    const pinned = await store.getUrl(assetId);
    const lease3 = await store.retainUrl(assetId);
    lease3?.release();
    expect(urls.live.has(pinned ?? '')).toBe(true);
  });

  it('uploads new assets and downloads missing ones through the remote', async () => {
    const uploads: AssetInfo[] = [];
    const serverBlob = new Blob(['from the server'], { type: 'text/plain' });
    const remote: RemoteAssets = {
      enqueueUpload: (info) => uploads.push(info),
      download: vi.fn(async (assetId: string) =>
        assetId === 'f'.repeat(64)
          ? {
              blob: serverBlob,
              info: {
                assetId,
                name: 'notes.txt',
                mimeType: 'text/plain',
                size: serverBlob.size,
                createdAt: 1,
              },
            }
          : null,
      ),
    };
    const store = await openStore({ urls: fakeUrls(), remote });
    const { assetId } = await store.put(new Blob(['local']));
    await store.put(new Blob(['local']));
    expect(uploads.map((info) => info.assetId)).toEqual([assetId]);

    const downloaded = await store.get('f'.repeat(64));
    expect(await downloaded?.text()).toBe('from the server');
    // Cached locally: the second read doesn't hit the server.
    expect(await store.has('f'.repeat(64))).toBe(true);
    await store.get('f'.repeat(64));
    expect(remote.download).toHaveBeenCalledTimes(1);
    expect(await store.get('e'.repeat(64))).toBeNull();
  });
});
