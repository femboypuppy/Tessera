import { COMMANDS, defineFeature, PANELS } from '@tessera/core';
import { GraphViewRoute, LocalGraphPanel, openGraph } from '@tessera/search/graph';
import { t } from '@tessera/search/i18n';
import { Network, Waypoints } from 'lucide-react';

/**
 * Graph view (Agent 05): the `/graph` route (sigma.js + graphology, ForceAtlas2 in a worker), the
 * local-graph side panel and `COMMANDS.openGraph`. Components load on demand from
 * `@tessera/search/graph`.
 */
export const graphFeature = defineFeature({
  id: 'graph',
  routes: [{ path: '/graph', component: GraphViewRoute }],
  pageSidePanels: [
    {
      id: PANELS.localGraph,
      title: t('localGraph'),
      icon: Waypoints,
      order: 20,
      component: LocalGraphPanel,
    },
  ],
  commands: [
    {
      id: COMMANDS.openGraph,
      title: t('cmdOpenGraph'),
      group: 'navigation',
      icon: Network,
      keywords: ['graph', 'map', 'links', 'network'],
      run: ({ app }) => openGraph(app),
    },
    {
      id: 'graph.showLocal',
      title: t('cmdShowLocalGraph'),
      group: 'view',
      icon: Waypoints,
      keywords: ['graph', 'neighbors', 'links'],
      when: ({ pageId }) => pageId !== null,
      run: ({ app }) => app.openSidePanel(PANELS.localGraph),
    },
  ],
});
