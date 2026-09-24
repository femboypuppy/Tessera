import {
  toError,
  type AppContext,
  type ConfirmOptions,
  type ToastOptions,
  type WorkspaceRegistry,
} from '@tessera/core';
import type { DesktopBackend } from '../backend/backend';
import type { CloudProvider, FolderInfo } from '../backend/protocol';
import { t } from '../i18n';
import { TauriWorkspaceRegistry } from '../stores/workspace-registry';

/** The desktop registry behind `ctx.services.workspaceRegistry`, or null outside the desktop app. */
export function desktopRegistry(registry: WorkspaceRegistry): TauriWorkspaceRegistry | null {
  return registry instanceof TauriWorkspaceRegistry ? registry : null;
}

export function providerName(provider: CloudProvider): string {
  return t(`provider_${provider}`);
}

/**
 * What the flows need from the app: confirmations and toasts. The workspace context provides
 * them; with no workspace open, `toast` and `confirm` from `@tessera/ui` do (their hosts are
 * mounted at the app root).
 */
export interface FlowUi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  toast(options: ToastOptions): unknown;
}

/**
 * Asks before using a folder that is synced by a cloud service or already has files in it.
 * Returns false when the user backs out.
 */
export async function confirmFolder(folder: FolderInfo, ui: FlowUi): Promise<boolean> {
  if (!folder.workspace && folder.entries > 0) {
    const ok = await ui.confirm({
      title: t('useFolderTitle', { name: folder.name }),
      description: t('useFolderBody', { count: folder.entries }),
      confirmLabel: t('useFolder'),
    });
    if (!ok) return false;
  }
  if (folder.cloud) {
    const provider = providerName(folder.cloud.provider);
    return ui.confirm({
      title: t('cloudTitle', { provider }),
      description: t('cloudBody', { provider }),
      confirmLabel: t('cloudContinue'),
    });
  }
  return true;
}

function reportFailure(ui: FlowUi, error: unknown): void {
  const err = toError(error);
  const newer = /newer version/i.test(err.message);
  ui.toast({
    variant: 'error',
    title: t('openFailed'),
    description: newer ? t('newerFormat') : err.message,
  });
}

/**
 * "Open folder…": picks a folder with the native dialog, then opens the workspace it holds or
 * makes it a new workspace. Returns the workspace ID to switch to, or null.
 */
export async function pickAndOpenFolder(
  backend: DesktopBackend,
  registry: TauriWorkspaceRegistry,
  ui: FlowUi,
): Promise<string | null> {
  const path = await backend.pickFolder(
    t('chooseFolderTitle'),
    registry.defaultFolder ?? undefined,
  );
  if (!path) return null;
  try {
    const folder = await backend.inspectFolder(path);
    if (!(await confirmFolder(folder, ui))) return null;
    const result = await registry.openFolder(folder);
    return result.workspace.id;
  } catch (error) {
    reportFailure(ui, error);
    return null;
  }
}

/** Creates a workspace in `parent/<name>` (the folder appears on the first edit). */
export async function createWorkspaceIn(
  backend: DesktopBackend,
  registry: TauriWorkspaceRegistry,
  ui: FlowUi,
  input: { name: string; parent: string },
): Promise<string | null> {
  try {
    const path = await backend.suggestFolder(input.parent, input.name);
    const folder = await backend.inspectFolder(path);
    if (folder.cloud) {
      const provider = providerName(folder.cloud.provider);
      const ok = await ui.confirm({
        title: t('cloudTitle', { provider }),
        description: t('cloudBody', { provider }),
        confirmLabel: t('cloudContinue'),
      });
      if (!ok) return null;
    }
    const workspace = await registry.create({ name: input.name, path });
    return workspace.id;
  } catch (error) {
    reportFailure(ui, error);
    return null;
  }
}

/** Points a workspace whose folder went missing at the folder the user picks. */
export async function locateWorkspace(
  backend: DesktopBackend,
  registry: TauriWorkspaceRegistry,
  ui: FlowUi,
  workspace: { id: string; name: string },
): Promise<boolean> {
  const path = await backend.pickFolder(t('locateTitle', { name: workspace.name }));
  if (!path) return false;
  try {
    const folder = await backend.inspectFolder(path);
    if (!folder.workspace || folder.workspace.id !== workspace.id) {
      ui.toast({
        variant: 'error',
        title: t('openFailed'),
        description: t('notThisWorkspace', { folder: folder.name, name: workspace.name }),
      });
      return false;
    }
    await registry.locate(workspace.id, folder);
    return true;
  } catch (error) {
    reportFailure(ui, error);
    return false;
  }
}

/**
 * The onboarding button "Open a workspace folder". The shell has already created and opened a
 * new, empty workspace; nothing of it is on disk yet (folders appear on the first write). If the
 * user picks a folder, that workspace takes its place in the list; if not, they keep it.
 */
export async function openFolderFromOnboarding(
  backend: DesktopBackend,
  ctx: AppContext,
): Promise<void> {
  const registry = desktopRegistry(ctx.services.workspaceRegistry);
  if (!registry) return;
  const placeholder = ctx.workspace.info;
  const id = await pickAndOpenFolder(backend, registry, ctx);
  if (!id || id === placeholder.id) return;
  const empty = ctx.workspace.pages.getSnapshot().all().length === 0;
  if (empty) {
    const items = await registry.listAll();
    if (items.find((item) => item.id === placeholder.id)?.status === 'new')
      await registry.remove(placeholder.id);
  }
  ctx.switchWorkspace(id);
}
