import type { WorkspaceApi } from '@tessera/core';
import { IndexedDbPluginStore } from '../store/idb-store';
import { MemoryPluginStore } from '../store/memory-store';
import { PluginManager, type ChangeChannel } from '../manager';
import { PluginConsoleStore } from './console';
import type { PluginHost } from './plugin-host';

/**
 * App-wide singletons of the plugins feature: the manager (installed plugins on this device), the
 * consoles, and the host of each open workspace session (keyed by its `WorkspaceApi`, which is the
 * same object for `activate(ctx)` and for `useAppContext()`).
 */

const hosts = new WeakMap<WorkspaceApi, PluginHost>();
const hostListeners = new Set<() => void>();
let hostVersion = 0;

export function setPluginHost(workspace: WorkspaceApi, host: PluginHost | null): void {
  if (host) hosts.set(workspace, host);
  else hosts.delete(workspace);
  hostVersion += 1;
  for (const listener of [...hostListeners]) listener();
}

export function getPluginHost(workspace: WorkspaceApi): PluginHost | undefined {
  return hosts.get(workspace);
}

export function subscribePluginHosts(listener: () => void): () => void {
  hostListeners.add(listener);
  return () => hostListeners.delete(listener);
}

export function getPluginHostsVersion(): number {
  return hostVersion;
}

let managerPromise: Promise<PluginManager> | null = null;

/** The device's plugin manager (IndexedDB, or memory when IndexedDB is unavailable). */
export function getPluginManager(): Promise<PluginManager> {
  managerPromise ??= (async () => {
    let store;
    try {
      if (typeof indexedDB === 'undefined') throw new Error('No IndexedDB');
      store = await IndexedDbPluginStore.open();
    } catch (error) {
      console.warn(
        '[plugins] IndexedDB is unavailable; installed plugins last until reload',
        error,
      );
      store = new MemoryPluginStore();
    }
    let channel: ChangeChannel | null = null;
    try {
      channel =
        typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('tessera-plugins');
    } catch {
      channel = null;
    }
    const manager = new PluginManager(store, { channel });
    await manager.ready;
    return manager;
  })();
  return managerPromise;
}

/** The console of every plugin, for the whole app run. */
export const pluginConsoles = new PluginConsoleStore();
