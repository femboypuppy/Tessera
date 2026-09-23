import type { StorageServiceContext } from '@tessera/core';
import { getBackend, installAppListeners, onReset } from './runtime';

export { TAURI_ASSET_STORE_ID, TAURI_DOC_STORE_ID, TAURI_REGISTRY_ID } from './constants';
import { TauriAssetStore } from './stores/asset-store';
import { TauriDocStore } from './stores/doc-store';
import { TauriWorkspaceRegistry } from './stores/workspace-registry';

let appRegistry: TauriWorkspaceRegistry | null = null;
onReset(() => {
  appRegistry?.dispose();
  appRegistry = null;
});

/** The registry created at startup (menus use it when no workspace is open). */
export function getAppRegistry(): TauriWorkspaceRegistry | null {
  return appRegistry;
}

/** App phase: the workspace registry. Also installs the page-wide listeners (exit flush). */
export async function createWorkspaceRegistry(): Promise<TauriWorkspaceRegistry> {
  // The first-run screen shows the desktop's onboarding action, whose strings live here.
  await import('./i18n');
  const backend = getBackend();
  installAppListeners(backend);
  const info = await backend.appInfo();
  appRegistry = new TauriWorkspaceRegistry(backend, { defaultRoot: info.defaultRoot });
  return appRegistry;
}

/** Storage phase: `tessera.db` of the workspace folder. */
export function openDocStore({ workspace }: StorageServiceContext): Promise<TauriDocStore> {
  return TauriDocStore.open(getBackend(), workspace);
}

/** Storage phase: `assets/` of the workspace folder. */
export function openAssetStore({ workspace }: StorageServiceContext): Promise<TauriAssetStore> {
  return TauriAssetStore.open(getBackend(), workspace);
}
