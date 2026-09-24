import type { AppContext } from '@tessera/core';
import { confirm, toast } from '@tessera/ui';
import { openDeepLink, openPendingLink } from './commands';
import { registerDesktopContributions } from './contributions';
import { t } from './i18n';
import { DESKTOP_COMMANDS, TAURI_DOC_STORE_ID, WINDOWS } from './constants';
import { buildAppMenu } from './menu/app-menu';
import { MenuDispatcher } from './menu/dispatch';
import { currentMirror, MarkdownMirror } from './mirror/mirror';
import {
  getBackend,
  getCurrentContext,
  onReset,
  registerFlushable,
  setCurrentContext,
} from './runtime';
import { getAppRegistry } from './services';
import { checkOnStartup } from './updates/updates';
import { pickAndOpenFolder } from './workspace/flows';
import { refreshFolderStatus } from './workspace/status';

let dispatcher: MenuDispatcher | null = null;
onReset(() => {
  dispatcher?.dispose();
  dispatcher = null;
});

/**
 * Native menu events go through one dispatcher per page, acting on whatever workspace is open.
 * Without one (the last workspace was removed), the workspace items still work: they add the
 * folder and reload, which opens it.
 */
function ensureMenuDispatcher(isApple: boolean): MenuDispatcher {
  if (dispatcher) return dispatcher;
  const backend = getBackend();
  const menu = new MenuDispatcher(getCurrentContext, {
    isApple,
    fallback: async (id) => {
      const workspaceItems: string[] = [
        DESKTOP_COMMANDS.openFolder,
        DESKTOP_COMMANDS.openWorkspaces,
        DESKTOP_COMMANDS.newWorkspace,
      ];
      const registry = getAppRegistry();
      if (!workspaceItems.includes(id) || !registry) return false;
      const workspaceId = await pickAndOpenFolder(backend, registry, { confirm, toast });
      if (workspaceId) {
        // The shell opens the most recently opened workspace at startup.
        await registry.open(workspaceId);
        window.location.reload();
      }
      return true;
    },
  });
  backend.onMenu((id) => void menu.dispatch(id));
  dispatcher = menu;
  return menu;
}

/**
 * Runs each time a workspace opens in a desktop window. The quick-capture window only needs its
 * services; the main window also gets menus, the title, deep links, the markdown mirror, folder
 * checks and update checks.
 */
export async function activateDesktop(ctx: AppContext): Promise<() => void> {
  const backend = getBackend();
  const cleanups: Array<() => void> = [];
  registerDesktopContributions(ctx);
  setCurrentContext(ctx);
  cleanups.push(() => {
    if (getCurrentContext() === ctx) setCurrentContext(null);
  });

  if (ctx.serviceSources.docStore !== TAURI_DOC_STORE_ID) {
    // The folder couldn't be opened and the runtime fell back to another store: say so loudly.
    ctx.toast({
      variant: 'error',
      title: t('storageFallbackTitle'),
      description: t('storageFallbackBody'),
      durationMs: 30_000,
    });
  }

  if (backend.windowLabel === WINDOWS.capture) {
    // The quick-capture window only ever shows /capture (switching workspaces goes home first).
    if (window.location.pathname !== '/capture') ctx.navigateTo('/capture', { replace: true });
    // It captures into the workspace open in the main window: the most recently opened one.
    cleanups.push(
      ctx.services.workspaceRegistry.subscribe(([latest]) => {
        if (latest && latest.id !== ctx.workspace.info.id) ctx.switchWorkspace(latest.id);
      }),
    );
  }
  if (backend.windowLabel !== WINDOWS.main) {
    return () => cleanups.reverse().forEach((cleanup) => cleanup());
  }

  const workspace = ctx.workspace.info;
  const setTitle = (name: string) =>
    void backend.setWindowTitle(t('windowTitle', { workspace: name })).catch(() => undefined);
  setTitle(workspace.name);
  cleanups.push(
    ctx.services.workspaceRegistry.subscribe((list) => {
      const current = list.find((candidate) => candidate.id === workspace.id);
      if (current) setTitle(current.name);
    }),
  );

  const menu = ensureMenuDispatcher(ctx.platform.isApple);
  const built = buildAppMenu(ctx, { isMac: ctx.platform.os === 'mac' });
  menu.setShortcuts(built.shortcuts);
  void backend.setMenu(built.spec).catch((error: unknown) => {
    console.warn('[desktop] could not set the native menus', error);
  });

  const takeLinks = async () => {
    for (const link of await backend.takeLinks()) await openDeepLink(ctx, link);
  };
  void openPendingLink(ctx).then(takeLinks);
  cleanups.push(backend.onDeepLink(() => void takeLinks()));

  const mirror = new MarkdownMirror(ctx, backend);
  mirror.start();
  currentMirror.set(mirror);
  cleanups.push(
    registerFlushable(() => mirror.flush()),
    () => {
      mirror.stop();
      if (currentMirror.get() === mirror) currentMirror.set(null);
    },
  );

  void refreshFolderStatus(backend, workspace.id).then((status) => {
    if (status && status.conflicts.length > 0) {
      ctx.toast({
        variant: 'warning',
        title: t('conflictsTitle'),
        description: t('conflictCount', { count: status.conflicts.length }),
        durationMs: 15_000,
        action: { label: t('review'), onClick: () => ctx.navigateTo('/settings/desktop') },
      });
    }
  });

  void checkOnStartup(ctx, backend).catch(() => undefined);

  return () => cleanups.reverse().forEach((cleanup) => cleanup());
}
