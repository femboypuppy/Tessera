import { defineFeature, defineService, SERVICE_PRIORITY } from '@tessera/core';

/**
 * Backlinks (Agent 05): the graph link index (priority 50). It shares the index worker with the
 * search index; everything heavy lives in `@tessera/search` subpaths and loads on demand.
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
});
