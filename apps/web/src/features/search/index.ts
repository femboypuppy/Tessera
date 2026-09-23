import { defineFeature, defineService, SERVICE_PRIORITY } from '@tessera/core';

/**
 * Search (Agent 05): the MiniSearch search index (priority 50). Everything heavy lives in
 * `@tessera/search` subpaths and loads on demand.
 */
export const searchFeature = defineFeature({
  id: 'search',
  services: [
    defineService({
      provides: 'searchIndex',
      id: 'minisearch',
      priority: SERVICE_PRIORITY.browser,
      create: async (context) =>
        (await import('@tessera/search/services')).createSearchIndex(context),
    }),
  ],
});
