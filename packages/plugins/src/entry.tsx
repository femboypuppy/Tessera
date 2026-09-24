import type { AppContext, BlockRendererProps } from '@tessera/core';
import { Skeleton, Spinner } from '@tessera/ui';
import { lazy, Suspense } from 'react';

/**
 * @tessera/plugins/entry — the light pieces the feature registers statically (they end up in the
 * startup bundle). Everything heavy (the host, zod, fflate, the settings UI) loads on demand.
 */

const LazyBlock = lazy(() => import('./ui/PluginBlock'));
const LazySettings = lazy(() => import('./ui/settings/PluginsSettings'));

/** The renderer of every `plugin:` embed. */
export function PluginBlockEntry(props: BlockRendererProps) {
  return (
    <Suspense fallback={<Skeleton className="h-24 w-full rounded-lg" />}>
      <LazyBlock {...props} />
    </Suspense>
  );
}

/** Settings → Plugins. */
export function PluginsSettingsEntry() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      }
    >
      <LazySettings />
    </Suspense>
  );
}

/** Runs `callback` when the browser is idle (at most two seconds later). */
function whenIdle(callback: () => void): () => void {
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(callback, { timeout: 2_000 });
    return () => cancelIdleCallback(handle);
  }
  const handle = setTimeout(callback, 200);
  return () => clearTimeout(handle);
}

/**
 * Starts the plugin host for a workspace session; returns its cleanup. The host loads once the
 * browser is idle, so plugins never compete with the workspace's first paint and input.
 */
export function activatePlugins(ctx: AppContext): () => void {
  let cleanup: (() => void) | null = null;
  let cancelled = false;
  const cancelIdle = whenIdle(() => {
    import('./host/index')
      .then(({ startPluginHost }) => {
        if (!cancelled) cleanup = startPluginHost(ctx);
      })
      .catch((error: unknown) => console.error('[plugins] Could not load the plugin host', error));
  });
  return () => {
    cancelled = true;
    cancelIdle();
    cleanup?.();
  };
}
