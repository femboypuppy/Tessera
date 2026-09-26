import { toError, type AppContext } from '@tessera/core';
import type { DesktopBackend } from '../backend/backend';
import type { UpdateInfo } from '../backend/protocol';
import { t } from '../i18n';
import { createStore } from '../lib/store';

export const RELEASES_URL = 'https://github.com/femboypuppy/Tessera-Notes/releases';
const DAY = 24 * 60 * 60 * 1000;

export type UpdateState =
  | { phase: 'idle' }
  | { phase: 'checking' }
  | { phase: 'up-to-date'; version: string }
  | { phase: 'available'; version: string; notes: string | null }
  | { phase: 'downloading'; percent: number }
  | { phase: 'installing' }
  | { phase: 'not-configured' }
  | { phase: 'error'; message: string };

export const updateStore = createStore<UpdateState>({ phase: 'idle' });

export async function checkForUpdates(backend: DesktopBackend): Promise<UpdateInfo | null> {
  updateStore.set({ phase: 'checking' });
  try {
    const info = await backend.checkForUpdate();
    await backend.markUpdatesChecked().catch(() => undefined);
    if (!info.configured) updateStore.set({ phase: 'not-configured' });
    else if (info.available && info.version)
      updateStore.set({ phase: 'available', version: info.version, notes: info.notes });
    else updateStore.set({ phase: 'up-to-date', version: info.currentVersion });
    return info;
  } catch (error) {
    updateStore.set({ phase: 'error', message: toError(error).message });
    return null;
  }
}

/** Downloads, verifies and installs the update, then the app restarts (Rust flushes first). */
export async function installUpdate(backend: DesktopBackend): Promise<void> {
  updateStore.set({ phase: 'downloading', percent: 0 });
  const off = backend.onUpdateProgress(({ downloaded, total }) => {
    updateStore.set(
      total
        ? { phase: 'downloading', percent: Math.min(100, Math.round((downloaded / total) * 100)) }
        : { phase: 'downloading', percent: 0 },
    );
  });
  try {
    await backend.installUpdate();
    updateStore.set({ phase: 'installing' });
  } catch (error) {
    updateStore.set({ phase: 'error', message: toError(error).message });
  } finally {
    off();
  }
}

/** The "Check for updates…" menu item: always reports the outcome. */
export async function checkForUpdatesInteractive(
  ctx: AppContext,
  backend: DesktopBackend,
): Promise<void> {
  const info = await checkForUpdates(backend);
  const state = updateStore.get();
  if (state.phase === 'error') {
    ctx.toast({ variant: 'error', title: t('updateCheckFailed', { message: state.message }) });
  } else if (info && !info.configured) {
    ctx.toast({
      title: t('updatesNotConfigured'),
      action: { label: t('openReleases'), onClick: () => void backend.openExternal(RELEASES_URL) },
    });
  } else if (info?.available && info.version) {
    ctx.toast({
      title: t('updateAvailableToast', { version: info.version }),
      durationMs: 15_000,
      action: { label: t('installAndRestart'), onClick: () => void installUpdate(backend) },
    });
  } else {
    ctx.toast({ variant: 'success', title: t('upToDate') });
  }
}

/** At startup: checks once a day when enabled, and only speaks up when there is an update. */
export async function checkOnStartup(ctx: AppContext, backend: DesktopBackend): Promise<void> {
  const [prefs, app] = await Promise.all([backend.getPrefs(), backend.appInfo()]);
  if (!prefs.checkUpdates || !app.updatesConfigured) return;
  if (prefs.lastUpdateCheck && Date.now() - prefs.lastUpdateCheck < DAY) return;
  const info = await checkForUpdates(backend);
  if (info?.available && info.version) {
    ctx.toast({
      title: t('updateAvailableToast', { version: info.version }),
      durationMs: 15_000,
      action: { label: t('installAndRestart'), onClick: () => void installUpdate(backend) },
    });
  }
}
