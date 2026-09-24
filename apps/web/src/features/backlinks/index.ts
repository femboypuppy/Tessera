import { defineFeature, defineService, PANELS, SERVICE_PRIORITY } from '@tessera/core';
import {
  BacklinksFooterHost,
  BacklinksPanel,
  BacklinksSettingsHost,
} from '@tessera/search/backlinks';
import { t } from '@tessera/search/i18n';
import { Link2 } from 'lucide-react';

/**
 * Backlinks (Agent 05): the graph link index (priority 50, sharing the index worker with search),
 * the backlinks side panel, the optional footer (workspace setting `backlinks.showFooter`) and its
 * settings section. Components load on demand from `@tessera/search/backlinks`.
 */
export const backlinksFeature = defineFeature({
  id: 'backlinks',
  services: [
    defineService({
      provides: 'linkIndex',
      id: 'graph',
      priority: SERVICE_PRIORITY.browser,
      create: async (context) =>
        (await import('@tessera/search/services')).createLinkIndex(context),
    }),
  ],
  pageSidePanels: [
    {
      id: PANELS.backlinks,
      title: t('backlinks'),
      icon: Link2,
      order: 10,
      component: BacklinksPanel,
    },
  ],
  pageFooterSections: [{ id: 'backlinks', component: BacklinksFooterHost }],
  settingsPanels: [
    {
      id: 'backlinks',
      title: t('settingsTitle'),
      description: t('settingsDescription'),
      icon: Link2,
      keywords: ['links', 'mentions', 'references'],
      component: BacklinksSettingsHost,
    },
  ],
  commands: [
    {
      id: 'backlinks.show',
      title: t('cmdShowBacklinks'),
      group: 'view',
      icon: Link2,
      keywords: ['references', 'mentions', 'links'],
      when: ({ pageId }) => pageId !== null,
      run: ({ app }) => app.openSidePanel(PANELS.backlinks),
    },
  ],
});
