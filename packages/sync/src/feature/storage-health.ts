import type { AppContext } from '@tessera/core';
import { t } from '../i18n';
import { IndexedDbAssetStore } from '../stores/asset-store';
import { IndexedDbDocStore } from '../stores/doc-store';
import type { StorageErrorInfo } from '../stores/storage-errors';

/** The same problem is toasted at most once in this window. */
const TOAST_THROTTLE_MS = 30_000;

/**
 * Turns local storage problems into clear toasts: a full disk, a workspace deleted in another tab,
 * or a browser that refuses to store anything (the app then runs on the in-memory stubs).
 */
export function watchStorageHealth(ctx: AppContext, now: () => number = Date.now): () => void {
  const lastToast = new Map<string, number>();
  const report = (info: StorageErrorInfo) => {
    const key = info.kind;
    const last = lastToast.get(key) ?? -Infinity;
    if (now() - last < TOAST_THROTTLE_MS) return;
    lastToast.set(key, now());
    if (info.kind === 'quota') {
      ctx.toast({
        variant: 'error',
        title: t('storageFullTitle'),
        description: t('storageFullBody'),
        durationMs: 12_000,
      });
    } else if (info.kind === 'closed') {
      ctx.toast({
        variant: 'warning',
        title: t('storageClosedTitle'),
        description: t('storageClosedBody'),
        action: { label: t('reload'), onClick: () => window.location.reload() },
        durationMs: 60_000,
      });
    } else {
      ctx.toast({
        variant: 'error',
        title: t('storageErrorTitle'),
        description: t('storageErrorBody', { message: info.error.message }),
        durationMs: 10_000,
      });
    }
  };

  const offs: Array<() => void> = [];
  const { docStore, assetStore } = ctx.services;
  if (docStore instanceof IndexedDbDocStore) offs.push(docStore.onStorageError(report));
  if (assetStore instanceof IndexedDbAssetStore) offs.push(assetStore.onStorageError(report));

  // IndexedDB exists but couldn't be opened (private browsing in some browsers, disabled
  // storage): the runtime fell back to memory. Say so once, loudly.
  const fellBack =
    typeof indexedDB !== 'undefined' &&
    !ctx.platform.isDesktopApp &&
    ctx.serviceSources.docStore === 'memory';
  if (fellBack) {
    ctx.toast({
      variant: 'warning',
      title: t('storageUnavailableTitle'),
      description: t('storageUnavailableBody'),
      durationMs: 30_000,
    });
  }
  return () => {
    for (const off of offs) off();
  };
}

/**
 * Asks the browser not to evict this origin's data under storage pressure. Chromium grants it
 * silently to engaged sites; Firefox may ask once. Never throws.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    const storage = typeof navigator === 'undefined' ? undefined : navigator.storage;
    if (!storage?.persist) return false;
    if (await storage.persisted?.()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
