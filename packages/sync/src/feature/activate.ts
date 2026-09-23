import type { AppContext } from '@tessera/core';
import { clearHistoryService, HistoryService, setHistoryService } from '../history/history-service';
import { LocalVersionStore } from '../history/version-store';
import { t } from '../i18n';
import { JOIN_WORKSPACE_KEY } from './keys';
import { installDebugHooks } from './debug';
import type { ServerSyncSession } from './server-sync';
import { requestPersistentStorage, watchStorageHealth } from './storage-health';

/**
 * The first-run "Join a workspace on a server" button: the shell created an empty workspace;
 * remember it (it's forgotten once the person joins) and open the connect form.
 */
export function startJoin(ctx: AppContext): void {
  ctx.settings.device.set(JOIN_WORKSPACE_KEY, ctx.workspace.info.id);
  ctx.navigateTo('/settings/sync?join=1');
}

async function startHistory(
  ctx: AppContext,
  server: ServerSyncSession | null,
): Promise<{ service: HistoryService | null; stop(): void }> {
  let store: LocalVersionStore;
  try {
    store = await LocalVersionStore.open(ctx.workspace.info.id);
  } catch (error) {
    console.warn('[sync] version history is unavailable', error);
    return { service: null, stop: () => undefined };
  }
  const service = new HistoryService(ctx, store, {
    server: server ? { api: server.api, syncState: server.syncState } : null,
  });
  service.start();
  server?.replicator.setVersionSource(async (id) => {
    const record = await store.get(id);
    if (!record) return null;
    const { docName, createdAt, kind, label, state } = record;
    return { id, docName, createdAt, kind, label, state };
  });
  const offCommand = ctx.commands.register({
    id: 'sync.saveVersion',
    title: t('saveVersion'),
    group: 'page',
    keywords: ['history', 'snapshot', 'version'],
    when: ({ pageId }) => pageId !== null && ctx.workspace.getPage(pageId)?.kind === 'page',
    run: async ({ pageId }) => {
      if (!pageId) return;
      await service.saveVersion(pageId, { kind: 'manual' });
      ctx.toast({ variant: 'success', title: t('versionSaved') });
    },
  });
  return {
    service,
    stop: () => {
      offCommand();
      service.dispose();
      store.dispose();
    },
  };
}

/**
 * Everything the sync feature does per workspace session, loaded lazily from the feature's
 * `activate`: storage health, server sync, version history. Returns the cleanup the runtime runs
 * when the session closes.
 */
export async function activateSync(ctx: AppContext): Promise<() => void> {
  const cleanups: Array<() => void> = [];
  cleanups.push(watchStorageHealth(ctx));
  if (ctx.serviceSources.docStore === 'indexeddb')
    void requestPersistentStorage({ interactive: false });
  // Local workspaces never load the sync provider's code.
  const server = ctx.workspace.info.serverUrl
    ? await (await import('./server-sync')).startServerSync(ctx)
    : { session: null, stop: () => undefined };
  cleanups.push(server.stop);
  const history = await startHistory(ctx, server.session);
  setHistoryService(ctx, history.service);
  cleanups.push(history.stop, () => clearHistoryService(ctx));
  cleanups.push(installDebugHooks(ctx));
  return () => {
    for (const cleanup of cleanups.reverse()) {
      try {
        cleanup();
      } catch (error) {
        console.error('[sync] cleanup failed', error);
      }
    }
  };
}
