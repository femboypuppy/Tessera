import { COMMANDS, defineFeature, defineService, SERVICE_PRIORITY } from '@tessera/core';
import { t } from '@tessera/search/i18n/registration';
import { openSearch, PaletteHost, paletteStore, pushRecent } from '@tessera/search/palette-host';
import { RefreshCw, Search, TextSearch } from 'lucide-react';
import { lazy } from 'react';

const SearchPage = lazy(() => import('@tessera/search/search-page'));

/**
 * Search (Agent 05): the MiniSearch search index (priority 50), the command palette (Mod+K), the
 * `/search` page and `COMMANDS.search`. Only the palette's tiny host is loaded at startup; the
 * palette, the search page and the index load on demand from `@tessera/search` subpaths.
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
  overlays: [{ id: 'palette', component: PaletteHost }],
  routes: [{ path: '/search', component: SearchPage }],
  commands: [
    {
      id: COMMANDS.openPalette,
      title: t('cmdOpenPalette'),
      group: 'navigation',
      icon: Search,
      shortcut: 'Mod+K',
      run: () => paletteStore.toggle(),
    },
    {
      id: COMMANDS.search,
      title: t('cmdSearchPage'),
      group: 'navigation',
      icon: TextSearch,
      shortcut: 'Mod+Shift+F',
      keywords: ['find', 'filter', 'tag'],
      run: ({ app, args }) => {
        const query = (args as { query?: unknown } | undefined)?.query;
        paletteStore.close();
        openSearch(app, { query: typeof query === 'string' ? query : '' });
      },
    },
    {
      id: 'search.rebuildIndex',
      title: t('cmdRebuildIndex'),
      group: 'workspace',
      icon: RefreshCw,
      keywords: ['reindex', 'index'],
      run: async ({ app }) => {
        const { searchIndex } = app.services;
        if (!searchIndex.rebuild) return;
        const toast = app.toast({ title: t('rebuildStarted') });
        try {
          await searchIndex.rebuild();
          toast.dismiss();
          app.toast({ title: t('rebuildDone'), variant: 'success' });
        } catch (error) {
          toast.dismiss();
          app.toast({
            title: t('rebuildFailed'),
            description: error instanceof Error ? error.message : undefined,
            variant: 'error',
          });
        }
      },
    },
  ],
  activate(ctx) {
    const offs = [
      ctx.events.on('navigation.changed', ({ pageId }) => {
        if (pageId) pushRecent(ctx.settings.device, ctx.workspace.info.id, pageId);
      }),
      () => paletteStore.close(),
    ];
    // Hooks for e2e specs and screenshots, off unless a device setting turns them on.
    if (ctx.settings.device.get('search.testHooks') === true) {
      let uninstall: (() => void) | null = null;
      let closed = false;
      void import('@tessera/search/test-hooks').then(({ installTestHooks }) => {
        if (!closed) uninstall = installTestHooks(ctx);
      });
      offs.push(() => {
        closed = true;
        uninstall?.();
      });
    }
    return () => {
      for (const off of offs) off();
    };
  },
});
