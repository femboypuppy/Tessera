import { SyncStateStore } from '../stores/sync-state';

/**
 * Per-workspace things shared by the services of a session (the asset store queues uploads;
 * the background sync sends them).
 */
const syncStates = new Map<string, Promise<SyncStateStore>>();

/** The workspace's sync bookkeeping store (opened once, reopened if it was closed). */
export function syncStateFor(workspaceId: string): Promise<SyncStateStore> {
  let pending = syncStates.get(workspaceId);
  if (!pending) {
    pending = SyncStateStore.open(workspaceId);
    syncStates.set(workspaceId, pending);
    pending.catch(() => syncStates.delete(workspaceId));
  }
  return pending.then((store) => {
    if (store.isOpen) return store;
    syncStates.delete(workspaceId);
    return syncStateFor(workspaceId);
  });
}

const outboxListeners = new Map<string, Set<() => void>>();

/** Tells the background sync of a workspace that the outbox has new work. */
export function signalOutbox(workspaceId: string): void {
  for (const listener of outboxListeners.get(workspaceId) ?? []) listener();
}

export function onOutboxSignal(workspaceId: string, listener: () => void): () => void {
  let set = outboxListeners.get(workspaceId);
  if (!set) {
    set = new Set();
    outboxListeners.set(workspaceId, set);
  }
  set.add(listener);
  return () => set.delete(listener);
}
