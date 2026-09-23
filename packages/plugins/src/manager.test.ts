import { describe, expect, it } from 'vitest';
import { PLUGIN_LIMITS } from './constants';
import { PluginManager, type ChangeChannel, type PluginChange } from './manager';
import { MemoryPluginStore } from './store/memory-store';
import { bundle } from './test/fixtures';

const source = { kind: 'file' as const, name: 'word-count.zip' };

async function setup() {
  const store = new MemoryPluginStore();
  const manager = new PluginManager(store, { now: () => 1_000 });
  await manager.ready;
  const changes: PluginChange[] = [];
  manager.subscribe((change) => changes.push(change));
  return { store, manager, changes };
}

describe('PluginManager lifecycle', () => {
  it('installs with the approved permissions only, enabled by default', async () => {
    const { manager, changes } = await setup();
    const installed = await manager.install(bundle(), {
      granted: ['pages:read', 'ui:panels', 'storage'],
      source,
    });
    expect(installed).toMatchObject({
      id: 'word-count',
      enabled: true,
      granted: ['pages:read', 'ui:panels'],
    });
    expect(installed.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await manager.getCode('word-count')).toEqual({ code: 'plugin:word-count@1.0.0' });
    expect(manager.getSnapshot().map((plugin) => plugin.id)).toEqual(['word-count']);
    expect(changes).toEqual([{ type: 'installed', id: 'word-count' }]);
  });

  it('plans installs, updates, reinstalls and downgrades with the new permissions', async () => {
    const { manager } = await setup();
    expect(manager.plan(bundle())).toMatchObject({
      kind: 'install',
      added: ['pages:read', 'ui:panels'],
    });
    await manager.install(bundle(), { granted: ['pages:read', 'ui:panels'], source });
    const update = manager.plan(
      bundle({ version: '1.1.0', permissions: ['pages:read', 'ui:panels', 'storage'] }),
    );
    expect(update).toMatchObject({ kind: 'update', added: ['storage'] });
    expect(manager.plan(bundle()).kind).toBe('reinstall');
    expect(manager.plan(bundle({ version: '0.9.0' })).kind).toBe('downgrade');
  });

  it('updates keep storage, settings, the enabled state and revoked permissions', async () => {
    const { manager, changes } = await setup();
    await manager.install(bundle(), { granted: ['pages:read'], source });
    await manager.setSettingsSchema('word-count', {
      goal: { type: 'number', label: 'Goal', default: 500 },
    });
    await manager.setSetting('word-count', 'goal', 750);
    await manager.storageSet('word-count', 'history', [1, 2, 3]);
    await manager.setEnabled('word-count', false);
    const updated = await manager.install(bundle({ version: '1.1.0' }, 'new code'), {
      granted: ['pages:read'],
      source,
    });
    expect(updated).toMatchObject({
      enabled: false,
      granted: ['pages:read'],
      settings: { goal: 750 },
    });
    expect(updated.manifest.version).toBe('1.1.0');
    expect(await manager.storageGet('word-count', 'history')).toEqual([1, 2, 3]);
    expect((await manager.getCode('word-count'))?.code).toBe('new code');
    expect(changes.map((change) => change.type)).toContain('updated');
  });

  it('enables, disables, grants and revokes', async () => {
    const { manager, changes } = await setup();
    await manager.install(bundle(), { granted: ['pages:read', 'ui:panels'], source });
    await manager.setEnabled('word-count', false);
    expect(manager.get('word-count')?.enabled).toBe(false);
    await manager.setEnabled('word-count', true);
    await manager.setPermission('word-count', 'pages:read', false);
    expect(manager.get('word-count')?.granted).toEqual(['ui:panels']);
    await manager.setPermission('word-count', 'pages:read', true);
    // Order follows the manifest; permissions it doesn't ask for can't be granted.
    await manager.setGranted('word-count', ['ui:panels', 'pages:read', 'pages:write']);
    expect(manager.get('word-count')?.granted).toEqual(['pages:read', 'ui:panels']);
    expect(changes.map((change) => change.type)).toEqual([
      'installed',
      'disabled',
      'enabled',
      'permissions',
      'permissions',
    ]);
  });

  it('uninstalls a plugin with its code and storage', async () => {
    const { manager, store, changes } = await setup();
    await manager.install(bundle(), { granted: [], source });
    await manager.storageSet('word-count', 'a', 1);
    await manager.uninstall('word-count');
    expect(manager.get('word-count')).toBeUndefined();
    expect(await store.getCode('word-count')).toBeUndefined();
    expect(await store.storageEntries('word-count')).toEqual([]);
    expect(changes.at(-1)).toEqual({ type: 'uninstalled', id: 'word-count' });
    await expect(manager.uninstall('word-count')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('validates settings against the declared schema and drops defaults', async () => {
    const { manager } = await setup();
    await manager.install(bundle(), { granted: [], source });
    await expect(manager.setSetting('word-count', 'goal', 1)).rejects.toThrow(/Unknown setting/);
    await manager.setSettingsSchema('word-count', {
      goal: { type: 'number', label: 'Goal', default: 500, min: 1 },
      mode: {
        type: 'select',
        label: 'Mode',
        default: 'words',
        options: [
          { value: 'words', label: 'Words' },
          { value: 'characters', label: 'Characters' },
        ],
      },
    });
    await expect(manager.setSetting('word-count', 'goal', 0)).rejects.toThrow(/at least 1/);
    await expect(manager.setSetting('word-count', 'mode', 'pages')).rejects.toThrow(/one of/);
    await manager.setSetting('word-count', 'mode', 'characters');
    await manager.setSetting('word-count', 'goal', 500);
    expect(manager.get('word-count')?.settings).toEqual({ mode: 'characters' });
    await manager.resetSettings('word-count');
    expect(manager.get('word-count')?.settings).toEqual({});
  });

  it('enforces storage quotas', async () => {
    const { manager } = await setup();
    await manager.install(bundle(), { granted: ['storage'], source });
    await expect(manager.storageSet('word-count', '', 1)).rejects.toThrow(/1 to 200/);
    await expect(
      manager.storageSet('word-count', 'k'.repeat(PLUGIN_LIMITS.storageKeyLength + 1), 1),
    ).rejects.toThrow(/1 to 200/);
    await expect(
      manager.storageSet('word-count', 'big', 'x'.repeat(PLUGIN_LIMITS.storageValueChars)),
    ).rejects.toThrow(/limited to 1 MB/);
    // Ten values of just under 1 MB fit in the 10 MB quota; an eleventh doesn't.
    const chunk = 'x'.repeat(PLUGIN_LIMITS.storageValueChars - 10);
    for (let i = 0; i < 10; i += 1) await manager.storageSet('word-count', `k${i}`, chunk);
    await expect(manager.storageSet('word-count', 'k10', chunk)).rejects.toThrow(/storage is full/);
    // Replacing a value counts only the new size.
    await manager.storageSet('word-count', 'k0', 'small');
    await manager.storageSet('word-count', 'k10', chunk);
    expect((await manager.storageKeys('word-count')).length).toBe(11);
    await manager.storageClear('word-count');
    expect(await manager.storageKeys('word-count')).toEqual([]);
  });

  it('tells other tabs about changes and follows theirs', async () => {
    const store = new MemoryPluginStore();
    const listeners = new Set<(event: MessageEvent) => void>();
    const peers: Array<{
      post(message: unknown): void;
      listeners: Set<(event: MessageEvent) => void>;
    }> = [];
    const channel = (): ChangeChannel => {
      const own = new Set<(event: MessageEvent) => void>();
      const peer = { post: (message: unknown) => void message, listeners: own };
      peers.push(peer);
      return {
        postMessage(message) {
          for (const other of peers)
            if (other !== peer)
              for (const listener of other.listeners) listener({ data: message } as MessageEvent);
        },
        addEventListener: (_type, listener) => own.add(listener),
        close: () => own.clear(),
      };
    };
    void listeners;
    const first = new PluginManager(store, { channel: channel() });
    const second = new PluginManager(store, { channel: channel() });
    await Promise.all([first.ready, second.ready]);
    const seen: PluginChange[] = [];
    second.subscribe((change) => seen.push(change));
    await first.install(bundle(), { granted: [], source });
    await expect.poll(() => second.get('word-count')?.manifest.name).toBe('Word count');
    expect(seen).toEqual([{ type: 'installed', id: 'word-count' }]);
    first.dispose();
    second.dispose();
  });
});
