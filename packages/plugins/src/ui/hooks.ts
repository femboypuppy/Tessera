import { useAppContext } from '@tessera/core/react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { PluginManager } from '../manager';
import type { PluginHost } from '../host/plugin-host';
import {
  getPluginHost,
  getPluginHostsVersion,
  getPluginManager,
  pluginConsoles,
  subscribePluginHosts,
} from '../host/registry';
import type { ConsoleEntry } from '../host/console';
import type { InstalledPlugin } from '../store/types';

const noop = () => () => undefined;
const zero = () => 0;

/** The plugin host of the open workspace (undefined until it has started). */
export function usePluginHost(): PluginHost | undefined {
  const { workspace } = useAppContext();
  useSyncExternalStore(subscribePluginHosts, getPluginHostsVersion, getPluginHostsVersion);
  return getPluginHost(workspace);
}

/** Re-renders when the host's plugins change status or registrations. */
export function useHostVersion(host: PluginHost | undefined): number {
  return useSyncExternalStore(
    host?.subscribe ?? noop,
    host?.getVersion ?? zero,
    host?.getVersion ?? zero,
  );
}

/** The device's plugin manager, once loaded. */
export function usePluginManager(): PluginManager | null {
  const [manager, setManager] = useState<PluginManager | null>(null);
  useEffect(() => {
    let active = true;
    void getPluginManager().then((value) => {
      if (active) setManager(value);
    });
    return () => {
      active = false;
    };
  }, []);
  return manager;
}

const EMPTY: readonly InstalledPlugin[] = [];

/** Installed plugins, re-rendering on every change. */
export function useInstalledPlugins(manager: PluginManager | null): readonly InstalledPlugin[] {
  return useSyncExternalStore(
    manager?.subscribeSnapshot ?? noop,
    manager?.getSnapshot ?? (() => EMPTY),
    manager?.getSnapshot ?? (() => EMPTY),
  );
}

/** A plugin's console, live. */
export function usePluginConsole(pluginId: string): readonly ConsoleEntry[] {
  useSyncExternalStore(
    pluginConsoles.subscribe,
    pluginConsoles.getVersion,
    pluginConsoles.getVersion,
  );
  return pluginConsoles.entries(pluginId);
}

/** Runs an async action with a busy flag and an error message. */
export function useAction(): {
  busy: boolean;
  error: string | null;
  run: <T>(action: () => Promise<T>) => Promise<T | undefined>;
  reset: () => void;
} {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T>(action: () => Promise<T>) => {
    setBusy(true);
    setError(null);
    try {
      return await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  const reset = useCallback(() => setError(null), []);
  return { busy, error, run, reset };
}
