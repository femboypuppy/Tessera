import 'fake-indexeddb/auto';
import { NotFoundError, ValidationError, type WorkspaceInfo } from '@tessera/core';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createChannelHub } from '../testing/channels';
import { IndexedDbDocStore } from './doc-store';
import { IndexedDbWorkspaceRegistry } from './workspace-registry';

const registries: IndexedDbWorkspaceRegistry[] = [];

async function openRegistry(
  options: Parameters<typeof IndexedDbWorkspaceRegistry.open>[0] = {},
): Promise<IndexedDbWorkspaceRegistry> {
  const registry = await IndexedDbWorkspaceRegistry.open({ channel: null, ...options });
  registries.push(registry);
  return registry;
}

afterEach(() => {
  for (const registry of registries.splice(0)) registry.dispose();
});

describe('IndexedDbWorkspaceRegistry', () => {
  it('creates, lists (most recently opened first), renames and updates workspaces', async () => {
    let clock = 1000;
    const registry = await openRegistry({ indexedDB: new IDBFactory(), now: () => clock });
    const personal = await registry.create({ name: '  Personal   notes ', icon: '📓' });
    clock = 2000;
    const team = await registry.create({ name: 'Team', serverUrl: 'https://sync.example.com' });
    expect(personal.name).toBe('Personal notes');
    expect((await registry.list()).map((ws) => ws.name)).toEqual(['Team', 'Personal notes']);
    await registry.open(personal.id);
    await registry.open(team.id);
    await registry.open(personal.id);
    expect((await registry.list()).map((ws) => ws.id)).toEqual([personal.id, team.id]);
    await registry.rename(team.id, 'Team space');
    const updated = await registry.update(team.id, { serverUrl: null, icon: '🚀' });
    expect(updated.serverUrl).toBeUndefined();
    expect(await registry.get(team.id)).toMatchObject({ name: 'Team space', icon: '🚀' });
  });

  it('keeps the server workspace ID and rejects duplicates and bad input', async () => {
    const registry = await openRegistry({ indexedDB: new IDBFactory() });
    const ws = await registry.create({ id: 'server-ws_1', name: 'From the server' });
    expect(ws.id).toBe('server-ws_1');
    await expect(registry.create({ id: 'server-ws_1', name: 'Again' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(registry.create({ id: 'bad id!', name: 'x' })).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(registry.create({ name: '   ' })).rejects.toBeInstanceOf(ValidationError);
    await expect(registry.open('missing')).rejects.toBeInstanceOf(NotFoundError);
    await expect(registry.update('missing', { name: 'x' })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('survives a reload', async () => {
    const factory = new IDBFactory();
    const first = await openRegistry({ indexedDB: factory });
    const ws = await first.create({ name: 'Kept' });
    first.dispose();
    const second = await openRegistry({ indexedDB: factory });
    expect(await second.get(ws.id)).toMatchObject({ id: ws.id, name: 'Kept' });
  });

  it('removing a workspace deletes its local data', async () => {
    const factory = new IDBFactory();
    const registry = await openRegistry({ indexedDB: factory });
    const ws = await registry.create({ name: 'Doomed' });
    const store = await IndexedDbDocStore.open(ws.id, { indexedDB: factory, channel: null });
    const doc = new Y.Doc();
    doc.getText('t').insert(0, 'secret');
    await store.storeUpdate('page:a', Y.encodeStateAsUpdate(doc));
    await store.dispose();
    await registry.remove(ws.id);
    expect(await registry.list()).toEqual([]);
    const reopened = await IndexedDbDocStore.open(ws.id, { indexedDB: factory, channel: null });
    expect(await reopened.load('page:a')).toBeNull();
    await reopened.dispose();
    await expect(registry.remove(ws.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('tells subscribers in other tabs about changes', async () => {
    const factory = new IDBFactory();
    const channels = createChannelHub();
    const tabA = await openRegistry({ indexedDB: factory, channel: channels });
    const tabB = await openRegistry({ indexedDB: factory, channel: channels });
    const seen: WorkspaceInfo[][] = [];
    tabB.subscribe((list) => seen.push(list));
    await tabA.create({ name: 'Shared' });
    await channels.pending();
    await vi.waitFor(() => expect(seen.at(-1)?.map((ws) => ws.name)).toEqual(['Shared']));
  });
});
