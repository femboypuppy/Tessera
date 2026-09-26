import { toError, type AppContext, type CommandContext } from '@tessera/core';
import type { DesktopBackend } from './backend/backend';
import type { DeepLink } from './backend/protocol';
import { t } from './i18n';
import { DESKTOP_COMMANDS } from './constants';
import { openPicker } from './picker/store';
import { getBackend, onReset } from './runtime';
import { checkForUpdatesInteractive, RELEASES_URL } from './updates/updates';
import { desktopRegistry, pickAndOpenFolder } from './workspace/flows';

export const REPO_URL = 'https://github.com/femboypuppy/Tessera-Notes';
export const DOCS_URL = `${REPO_URL}#readme`;
export const ISSUES_URL = `${REPO_URL}/issues/new/choose`;

/** `tessera://open/<pageId>?workspace=<workspaceId>`: opens the page in the desktop app. */
export function deepLinkFor(pageId: string, workspaceId: string): string {
  return `tessera://open/${encodeURIComponent(pageId)}?workspace=${encodeURIComponent(workspaceId)}`;
}

function reportError(ctx: AppContext, error: unknown): void {
  ctx.toast({ variant: 'error', title: t('openFailed'), description: toError(error).message });
}

async function zoom(ctx: AppContext, backend: DesktopBackend, delta: -1 | 0 | 1): Promise<void> {
  const level = await backend.zoom(delta);
  ctx.toast({ title: t('zoomLevel', { percent: Math.round(level * 100) }), durationMs: 1500 });
}

/** Runs one of the desktop commands registered in `feature.ts`. */
export async function runDesktopCommand(id: string, { app: ctx, pageId }: CommandContext) {
  const backend = getBackend();
  try {
    switch (id) {
      case DESKTOP_COMMANDS.openWorkspaces:
        openPicker('list');
        return;
      case DESKTOP_COMMANDS.newWorkspace:
        openPicker('new');
        return;
      case DESKTOP_COMMANDS.openFolder: {
        const registry = desktopRegistry(ctx.services.workspaceRegistry);
        if (!registry) return;
        const workspaceId = await pickAndOpenFolder(backend, registry, ctx);
        if (workspaceId && workspaceId !== ctx.workspace.info.id) ctx.switchWorkspace(workspaceId);
        return;
      }
      case DESKTOP_COMMANDS.revealWorkspace:
        if (ctx.workspace.info.path) await backend.revealFolder(ctx.workspace.info.path);
        return;
      case DESKTOP_COMMANDS.quickCapture:
        await backend.showCapture();
        return;
      case DESKTOP_COMMANDS.checkForUpdates:
        await checkForUpdatesInteractive(ctx, backend);
        return;
      case DESKTOP_COMMANDS.copyDeepLink:
        if (!pageId) return;
        await navigator.clipboard.writeText(deepLinkFor(pageId, ctx.workspace.info.id));
        ctx.toast({ variant: 'success', title: t('deepLinkCopied'), durationMs: 2000 });
        return;
      case DESKTOP_COMMANDS.zoomIn:
        return zoom(ctx, backend, 1);
      case DESKTOP_COMMANDS.zoomOut:
        return zoom(ctx, backend, -1);
      case DESKTOP_COMMANDS.resetZoom:
        return zoom(ctx, backend, 0);
      case DESKTOP_COMMANDS.toggleFullscreen:
        await backend.toggleFullscreen();
        return;
      case DESKTOP_COMMANDS.openDocs:
        await backend.openExternal(DOCS_URL);
        return;
      case DESKTOP_COMMANDS.openReleases:
        await backend.openExternal(RELEASES_URL);
        return;
      case DESKTOP_COMMANDS.reportIssue:
        await backend.openExternal(ISSUES_URL);
        return;
      default:
        return;
    }
  } catch (error) {
    reportError(ctx, error);
  }
}

/** A deep link that needs another workspace: kept until that workspace's session starts. */
let pendingLink: DeepLink | null = null;
onReset(() => {
  pendingLink = null;
});

/** Opens the page of a deep link, switching workspaces first when the link says so. */
export async function openDeepLink(ctx: AppContext, link: DeepLink): Promise<void> {
  if (link.workspaceId && link.workspaceId !== ctx.workspace.info.id) {
    const workspace = await ctx.services.workspaceRegistry.get(link.workspaceId);
    if (!workspace) {
      ctx.toast({ variant: 'error', title: t('linkWorkspaceMissing') });
      return;
    }
    pendingLink = link;
    ctx.switchWorkspace(link.workspaceId);
    return;
  }
  const page = ctx.workspace.getPage(link.pageId);
  if (!page) {
    ctx.toast({ variant: 'error', title: t('pageNotInWorkspace') });
    return;
  }
  const options: { heading?: string; blockId?: string } = {};
  if (link.heading) options.heading = link.heading;
  if (link.blockId) options.blockId = link.blockId;
  ctx.navigate(link.pageId, options);
}

/** Opens the link that was waiting for this workspace, if any. */
export async function openPendingLink(ctx: AppContext): Promise<void> {
  const link = pendingLink;
  if (!link || link.workspaceId !== ctx.workspace.info.id) return;
  pendingLink = null;
  await openDeepLink(ctx, link);
}
