import type { PluginPermission } from '@tessera/core';
import { bundleFromUrl, hashBundle } from '../bundle';
import type { PluginManager } from '../manager';

/** How a dev plugin's live reload is doing. */
export type DevStatus =
  | { state: 'watching'; lastCheck: number }
  | { state: 'reloaded'; lastCheck: number; reloadedAt: number }
  | { state: 'unreachable'; lastCheck: number; message: string };

/** Options of {@link watchDevPlugin}. */
export interface DevWatchOptions {
  manager: PluginManager;
  pluginId: string;
  url: string;
  onStatus(status: DevStatus): void;
  /** The new version asks for permissions the user hasn't granted. */
  onNewPermissions(permissions: PluginPermission[]): void;
  intervalMs?: number;
  fetch?: typeof fetch;
}

/**
 * Live reload for plugin authors: polls a local dev server (`pnpm dev` in a plugin folder) and
 * reinstalls the plugin whenever its manifest or code changes. Granted permissions are kept; new
 * ones are reported, never granted silently. Returns a function that stops watching.
 */
export function watchDevPlugin(options: DevWatchOptions): () => void {
  const interval = options.intervalMs ?? 1_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let controller: AbortController | null = null;
  const reported = new Set<string>();

  const check = async () => {
    if (stopped) return;
    controller = new AbortController();
    const now = Date.now();
    try {
      const fetchOptions: { signal: AbortSignal; fetch?: typeof fetch } = {
        signal: controller.signal,
      };
      if (options.fetch) fetchOptions.fetch = options.fetch;
      const bundle = await bundleFromUrl(options.url, fetchOptions);
      if (stopped) return;
      const installed = options.manager.get(options.pluginId);
      if (!installed || installed.source.kind !== 'dev') return;
      const hash = await hashBundle(bundle);
      if (bundle.manifest.id !== options.pluginId) {
        options.onStatus({
          state: 'unreachable',
          lastCheck: now,
          message: `The dev server now serves "${bundle.manifest.id}", not "${options.pluginId}"`,
        });
      } else if (hash !== installed.hash) {
        const added = bundle.manifest.permissions.filter(
          (permission) => !installed.manifest.permissions.includes(permission),
        );
        await options.manager.install(bundle, {
          granted: installed.granted,
          source: installed.source,
        });
        const unreported = added.filter((permission) => !reported.has(permission));
        if (unreported.length) {
          for (const permission of unreported) reported.add(permission);
          options.onNewPermissions(unreported);
        }
        options.onStatus({ state: 'reloaded', lastCheck: now, reloadedAt: Date.now() });
      } else {
        options.onStatus({ state: 'watching', lastCheck: now });
      }
    } catch (error) {
      if (stopped) return;
      options.onStatus({
        state: 'unreachable',
        lastCheck: now,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      controller = null;
      if (!stopped) timer = setTimeout(() => void check(), interval);
    }
  };
  timer = setTimeout(() => void check(), interval);
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    controller?.abort();
  };
}
