import type { AppContext, Command, CommandContext } from '@tessera/core';
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
import { currentWindowLabel, DESKTOP_COMMANDS, WINDOWS } from './constants';
import { t } from './i18n';

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
    // The quick-capture window runs the app too; its commands stay in the main window.
    when: (context: CommandContext) => isMainWindow() && (extra.when ? extra.when(context) : true),
    run: async (context) => (await commands()).runDesktopCommand(id, context),
  };
}

/** The desktop commands (palette, shortcuts, native menus). */
export function desktopCommands(): Command[] {
  return [
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
  ];
}

/**
 * Registers the desktop UI for a workspace session, from `activate` (so none of it is part of the
 * browser's bundle): the quick-capture route, the workspace picker, Settings → Desktop, the
 * sidebar's folder warning, and the commands. The session removes them when it closes.
 */
export function registerDesktopContributions(ctx: AppContext): void {
  const featureId = 'desktop';
  ctx.contributions.register(
    'routes',
    { path: '/capture', layout: 'bare', component: lazy(() => import('./capture/QuickCapture')) },
    featureId,
  );
  ctx.contributions.register(
    'overlays',
    { id: 'desktop-workspaces', component: lazy(() => import('./picker/PickerHost')) },
    featureId,
  );
  ctx.contributions.register(
    'settingsPanels',
    {
      id: 'desktop',
      title: t('settingsTitle'),
      description: t('settingsDescription'),
      icon: MonitorCog,
      order: 50,
      keywords: ['folder', 'markdown', 'quick capture', 'shortcut', 'tray', 'updates', 'keychain'],
      component: lazy(() => import('./settings/DesktopSettings')),
    },
    featureId,
  );
  ctx.contributions.register(
    'sidebarSections',
    {
      id: 'desktop-folder-status',
      position: 'bottom',
      order: 100,
      component: lazy(() => import('./sidebar/FolderStatus')),
    },
    featureId,
  );
  ctx.commands.registerMany(desktopCommands());
}
