import {
  defineFeature,
  defineService,
  SERVICE_PRIORITY,
  type Command,
  type CommandContext,
} from '@tessera/core';
import {
  BookOpen,
  Bug,
  Download,
  FolderOpen,
  FolderPlus,
  Inbox,
  Link,
  Maximize,
  MonitorCog,
  Newspaper,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { lazy } from 'react';
import {
  currentWindowLabel,
  DESKTOP_COMMANDS,
  TAURI_ASSET_STORE_ID,
  TAURI_DOC_STORE_ID,
  TAURI_REGISTRY_ID,
  WINDOWS,
} from './constants';
import { t } from './i18n';
import { isTauri } from './index';

const services = () => import('./services');
const commands = () => import('./commands');

const isMainWindow = () => currentWindowLabel() === WINDOWS.main;

function command(
  id: string,
  title: string,
  extra: Partial<Omit<Command, 'id' | 'title' | 'run'>> = {},
): Command {
  return {
    id,
    title,
    group: 'workspace',
    ...extra,
    when: (context: CommandContext) => isMainWindow() && (extra.when ? extra.when(context) : true),
    run: async (context) => (await commands()).runDesktopCommand(id, context),
  };
}

/**
 * The desktop feature, loaded only inside the Tauri app (`apps/web/src/features/desktop`). It
 * swaps in the folder-based storage (priority 100) and adds the workspace picker, quick capture,
 * the Desktop settings panel, native menus and deep links.
 */
export const desktopFeature = defineFeature({
  id: 'desktop',
  services: [
    defineService({
      provides: 'workspaceRegistry',
      id: TAURI_REGISTRY_ID,
      priority: SERVICE_PRIORITY.desktop,
      isAvailable: () => isTauri(),
      create: async () => (await services()).createWorkspaceRegistry(),
    }),
    defineService({
      provides: 'docStore',
      id: TAURI_DOC_STORE_ID,
      priority: SERVICE_PRIORITY.desktop,
      isAvailable: ({ workspace }) => isTauri() && Boolean(workspace.path),
      create: async (context) => (await services()).openDocStore(context),
    }),
    defineService({
      provides: 'assetStore',
      id: TAURI_ASSET_STORE_ID,
      priority: SERVICE_PRIORITY.desktop,
      isAvailable: ({ workspace }) => isTauri() && Boolean(workspace.path),
      create: async (context) => (await services()).openAssetStore(context),
    }),
  ],
  routes: [
    { path: '/capture', layout: 'bare', component: lazy(() => import('./capture/QuickCapture')) },
  ],
  overlays: [{ id: 'desktop-workspaces', component: lazy(() => import('./picker/PickerHost')) }],
  settingsPanels: [
    {
      id: 'desktop',
      title: t('settingsTitle'),
      description: t('settingsDescription'),
      icon: MonitorCog,
      order: 50,
      keywords: ['folder', 'markdown', 'quick capture', 'shortcut', 'tray', 'updates', 'keychain'],
      component: lazy(() => import('./settings/DesktopSettings')),
    },
  ],
  sidebarSections: [
    {
      id: 'desktop-folder-status',
      position: 'bottom',
      order: 100,
      component: lazy(() => import('./sidebar/FolderStatus')),
    },
  ],
  onboardingActions: [
    {
      id: 'desktop-open-folder',
      title: t('openFolderAction'),
      description: t('openFolderActionDescription'),
      icon: FolderOpen,
      order: 10,
      workspaceName: t('defaultWorkspaceName'),
      run: async (ctx) => {
        const [{ openFolderFromOnboarding }, { getBackend }] = await Promise.all([
          import('./workspace/flows'),
          import('./runtime'),
        ]);
        await openFolderFromOnboarding(getBackend(), ctx);
      },
    },
  ],
  commands: [
    command(DESKTOP_COMMANDS.openWorkspaces, t('openWorkspace'), {
      shortcut: 'Mod+O',
      icon: FolderOpen,
      keywords: ['switch', 'recent', 'folder'],
    }),
    command(DESKTOP_COMMANDS.newWorkspace, t('newWorkspace'), { icon: FolderPlus }),
    command(DESKTOP_COMMANDS.openFolder, t('openFolder'), { icon: FolderOpen }),
    command(DESKTOP_COMMANDS.revealWorkspace, t('revealWorkspace'), {
      icon: FolderOpen,
      keywords: ['finder', 'explorer', 'files'],
      when: ({ app }) => Boolean(app.workspace.info.path),
    }),
    command(DESKTOP_COMMANDS.quickCapture, t('quickCapture'), { icon: Inbox, keywords: ['inbox'] }),
    command(DESKTOP_COMMANDS.copyDeepLink, t('copyDeepLink'), {
      icon: Link,
      group: 'page',
      when: ({ pageId }) => pageId !== null,
    }),
    command(DESKTOP_COMMANDS.zoomIn, t('zoomIn'), {
      shortcut: ['Mod+=', 'Mod+Plus'],
      icon: ZoomIn,
      group: 'view',
    }),
    command(DESKTOP_COMMANDS.zoomOut, t('zoomOut'), {
      shortcut: 'Mod+-',
      icon: ZoomOut,
      group: 'view',
    }),
    command(DESKTOP_COMMANDS.resetZoom, t('actualSize'), { shortcut: 'Mod+0', group: 'view' }),
    command(DESKTOP_COMMANDS.toggleFullscreen, t('toggleFullScreen'), {
      shortcut: 'F11',
      icon: Maximize,
      group: 'view',
    }),
    command(DESKTOP_COMMANDS.checkForUpdates, t('checkForUpdates'), {
      icon: Download,
      group: 'help',
    }),
    command(DESKTOP_COMMANDS.openDocs, t('documentation'), { icon: BookOpen, group: 'help' }),
    command(DESKTOP_COMMANDS.openReleases, t('releaseNotes'), { icon: Newspaper, group: 'help' }),
    command(DESKTOP_COMMANDS.reportIssue, t('reportIssue'), { icon: Bug, group: 'help' }),
  ],
  activate: async (ctx) => (await import('./activate')).activateDesktop(ctx),
});
