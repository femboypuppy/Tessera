import 'fake-indexeddb/auto';
import { MemoryCredentialStore } from '@tessera/core';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  credentialStore,
  IndexedDbCredentialStore,
  serverApi,
  setCredentialStore,
} from './connection';

afterEach(() => {
  vi.useRealTimers();
});

describe('IndexedDbCredentialStore', () => {
  it('keeps one token per server origin, lists servers newest first and deletes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const store = new IndexedDbCredentialStore(new IDBFactory());
    vi.setSystemTime(1000);
    await store.set('https://notes.example.com/sync', 'first');
    vi.setSystemTime(2000);
    await store.set('https://other.example.org', 'second');
    expect(await store.get('https://notes.example.com')).toBe('first');
    expect(await store.list()).toEqual([
      { server: 'https://other.example.org', savedAt: 2000 },
      { server: 'https://notes.example.com', savedAt: 1000 },
    ]);
    await store.delete('https://notes.example.com/');
    expect(await store.get('https://notes.example.com')).toBeNull();
    expect((await store.list()).map((entry) => entry.server)).toEqual([
      'https://other.example.org',
    ]);
  });

  it('is replaced by the session credential store, and API clients use the new one', async () => {
    const keychain = new MemoryCredentialStore();
    await keychain.set('https://notes.example.com', 'from-keychain');
    setCredentialStore(keychain);
    expect(credentialStore()).toBe(keychain);
    const fetch = vi.fn(async () => Response.json({ user: null }));
    vi.stubGlobal('fetch', fetch);
    try {
      await serverApi('https://notes.example.com', 'bearer')
        .me()
        .catch(() => undefined);
      const [, init] = (fetch.mock.calls[0] ?? []) as unknown as [string, RequestInit | undefined];
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer from-keychain');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
