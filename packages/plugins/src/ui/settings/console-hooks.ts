import { useSyncExternalStore } from 'react';
import { pluginConsoles } from '../../host/registry';

/** Re-renders when any plugin console changes. */
export function usePluginConsoleVersion(): number {
  return useSyncExternalStore(
    pluginConsoles.subscribe,
    pluginConsoles.getVersion,
    pluginConsoles.getVersion,
  );
}
