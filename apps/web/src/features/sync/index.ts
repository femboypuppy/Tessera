import { defineFeature, PANELS } from '@tessera/core';
import { syncServices } from '@tessera/sync';
import { t } from '@tessera/sync/i18n';
import {
  HistoryPanelEntry,
  PresenceEntry,
  SyncSettingsEntry,
  SyncStatusEntry,
} from '@tessera/sync/ui';
import { Cloud, History } from 'lucide-react';

/**
 * Storage & sync (Agent 03): the IndexedDB stores and the Hocuspocus provider (priority 50),
 * the sync status, presence, version history and Settings → Sync & account. Registration only;
 * everything else lives in `@tessera/sync` behind dynamic imports. See HANDOFF/sync.md.
 */
export const syncFeature = defineFeature({
  id: 'sync',
  services: syncServices,
  topBarItems: [{ id: 'sync-status', order: 10, component: SyncStatusEntry }],
  pageHeaderActions: [{ id: 'presence', order: 0, component: PresenceEntry }],
  pageSidePanels: [
    {
      id: PANELS.history,
      title: t('historyTitle'),
      icon: History,
      order: 30,
      when: (page) => page?.kind === 'page',
      component: HistoryPanelEntry,
    },
  ],
  settingsPanels: [
    {
      id: 'sync',
      title: t('settingsTitle'),
      description: t('settingsDescription'),
      icon: Cloud,
      order: 10,
      keywords: ['server', 'account', 'sign in', 'invite', 'devices', 'sync'],
      component: SyncSettingsEntry,
    },
  ],
  onboardingActions: [
    {
      id: 'join-server',
      title: t('joinServerTitle'),
      description: t('joinServerDescription'),
      icon: Cloud,
      order: 50,
      workspaceName: t('joinServerWorkspaceName'),
      run: async (ctx) => (await import('@tessera/sync/activate')).startJoin(ctx),
    },
  ],
  async activate(ctx) {
    const { activateSync } = await import('@tessera/sync/activate');
    return activateSync(ctx);
  },
});
