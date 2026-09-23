import type { AppContext } from '@tessera/core';
import { domSandboxFactory, type SandboxFactory } from '../sandbox/frames';
import { emojiIcon } from '../ui/EmojiIcon';
import { pluginPanelComponent } from '../ui/PluginPanel';
import type { PluginManager } from '../manager';
import { PluginHost } from './plugin-host';
import { getPluginManager, pluginConsoles, setPluginHost } from './registry';
import { loadUiFonts, readTheme, watchTheme } from './theme';

/**
 * @tessera/plugins/host — loaded lazily by the plugins feature when a workspace opens.
 *
 * Starts the plugin host of a workspace session and returns its cleanup. Plugins start in the
 * background: the workspace opens without waiting for them.
 */
export function startPluginHost(
  ctx: AppContext,
  options: { manager?: Promise<PluginManager>; sandboxes?: SandboxFactory } = {},
): () => void {
  let host: PluginHost | null = null;
  let stopped = false;
  void (options.manager ?? getPluginManager())
    .then((manager) => {
      if (stopped) return;
      host = new PluginHost(ctx, {
        manager,
        console: pluginConsoles,
        sandboxes: options.sandboxes ?? domSandboxFactory,
        theme: {
          read: () => readTheme(),
          watch: (listener) => watchTheme(listener),
          fonts: () => loadUiFonts(),
        },
        panelComponent: pluginPanelComponent,
        emojiIcon,
      });
      setPluginHost(ctx.workspace, host);
      return host.start();
    })
    .catch((error: unknown) => console.error('[plugins] The plugin host failed to start', error));
  return () => {
    stopped = true;
    if (host) {
      setPluginHost(ctx.workspace, null);
      void host.dispose();
    }
  };
}

export { PluginHost } from './plugin-host';
export { PluginInstance } from './instance';
export { getPluginManager, getPluginHost, pluginConsoles } from './registry';
