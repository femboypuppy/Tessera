import { COMMANDS, SETTING_KEYS, type AppContext } from '@tessera/core';
import { useAppContext, useContributions } from '@tessera/core/react';
import { FeatureBoundary, Sheet, SheetContent, useIsCompact } from '@tessera/ui';
import { lazy, Suspense, useEffect } from 'react';
import { matchPath, Route, Routes, useLocation, useNavigate } from 'react-router';
import { t } from '../i18n';
import { ViewLoading } from './FullScreenLoading';
import { createPageAndOpen } from './page-helpers';
import { HomeView } from './pages/HomeView';
import { NotFoundView } from './pages/NotFoundView';
import { PageView, focusPageTitle } from './pages/PageView';
import { ShortcutsDialog } from './shortcuts/ShortcutsDialog';
import { SidePanelHost } from './SidePanelHost';
import { Sidebar } from './sidebar/Sidebar';
import { TopBar } from './TopBar';
import { toggleTheme } from './theme';
import { useUiStore } from './ui-store';

// Views off the startup path load on demand, and are preloaded once the app is idle.
const loadTrashView = () => import('./pages/TrashView');
const loadSettingsView = () => import('./settings/SettingsView');
const TrashView = lazy(() => loadTrashView().then((module) => ({ default: module.TrashView })));
const SettingsView = lazy(() =>
  loadSettingsView().then((module) => ({ default: module.SettingsView })),
);

function usePreloadViews() {
  useEffect(() => {
    const preload = () => {
      void loadTrashView();
      void loadSettingsView();
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(preload, { timeout: 5000 });
      return () => window.cancelIdleCallback(handle);
    }
    const timer = window.setTimeout(preload, 2000);
    return () => window.clearTimeout(timer);
  }, []);
}

function useShellCommands(ctx: AppContext) {
  const navigate = useNavigate();
  useEffect(() => {
    const ui = useUiStore.getState;
    return ctx.commands.registerMany([
      {
        id: COMMANDS.newPage,
        title: t('cmdNewPage'),
        group: 'page',
        shortcut: ['Mod+N', 'Mod+Alt+N'],
        run: ({ args }) => {
          const parentId = (args as { parentId?: string | null } | undefined)?.parentId ?? null;
          createPageAndOpen(ctx, navigate, parentId);
        },
      },
      {
        id: COMMANDS.toggleSidebar,
        title: t('cmdToggleSidebar'),
        group: 'view',
        shortcut: 'Mod+\\',
        run: () => {
          if (window.matchMedia('(max-width: 767px)').matches) ui().setDrawerOpen(!ui().drawerOpen);
          else {
            const open = !ui().sidebarOpen;
            ui().setSidebarOpen(open);
            ctx.settings.device.set(SETTING_KEYS.sidebarOpen, open);
          }
        },
      },
      {
        id: COMMANDS.toggleTheme,
        title: t('cmdToggleTheme'),
        group: 'view',
        shortcut: 'Mod+Shift+L',
        run: () => toggleTheme(ctx.settings.device),
      },
      {
        id: COMMANDS.showShortcuts,
        title: t('cmdShowShortcuts'),
        group: 'help',
        shortcut: ['?', 'Mod+/'],
        run: () => ui().setShortcutsOpen(true),
      },
      {
        id: COMMANDS.openSettings,
        title: t('cmdOpenSettings'),
        group: 'navigation',
        shortcut: 'Mod+,',
        run: () => ctx.navigateTo('/settings'),
      },
      {
        id: COMMANDS.openTrash,
        title: t('cmdOpenTrash'),
        group: 'navigation',
        run: () => ctx.navigateTo('/trash'),
      },
      {
        id: COMMANDS.focusTitle,
        title: t('cmdFocusTitle'),
        group: 'page',
        hidden: true,
        when: ({ pageId }) => pageId !== null,
        run: ({ args }) =>
          focusPageTitle((args as { position?: 'start' | 'end' } | undefined)?.position ?? 'end'),
      },
    ]);
  }, [ctx, navigate]);
}

function useGlobalShortcuts(ctx: AppContext) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const command = ctx.commands.findForEvent(event);
      if (!command) return;
      event.preventDefault();
      void ctx.commands.execute(command.id, { source: 'shortcut' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ctx]);
}

function useNavigationTracking(ctx: AppContext) {
  const location = useLocation();
  useEffect(() => {
    const pageId = matchPath('/p/:pageId', location.pathname)?.params.pageId ?? null;
    useUiStore.getState().setCurrentPageId(pageId);
    if (pageId) ctx.settings.device.set(`shell.lastPage.${ctx.workspace.info.id}`, pageId);
    ctx.events.emit('navigation.changed', { pageId, path: location.pathname });
  }, [ctx, location.pathname]);
}

function useSidebarPreferences(ctx: AppContext) {
  useEffect(() => {
    const ui = useUiStore.getState();
    const open = ctx.settings.device.get(SETTING_KEYS.sidebarOpen);
    const width = ctx.settings.device.get(SETTING_KEYS.sidebarWidth);
    if (typeof open === 'boolean') ui.setSidebarOpen(open);
    if (typeof width === 'number') ui.setSidebarWidth(width);
  }, [ctx]);
}

/** The workspace screen: sidebar, top bar, routed main view and side panel. */
export function AppLayout() {
  const ctx = useAppContext();
  const compact = useIsCompact();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const drawerOpen = useUiStore((state) => state.drawerOpen);
  const sidePanel = useUiStore((state) => state.sidePanel);
  const routes = useContributions('routes');
  useShellCommands(ctx);
  useGlobalShortcuts(ctx);
  useNavigationTracking(ctx);
  useSidebarPreferences(ctx);
  usePreloadViews();

  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <a
        href="#main"
        className="sr-only z-[var(--tess-z-tooltip)] rounded-md bg-surface px-3 py-2 text-sm shadow-popover focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        {t('skipToContent')}
      </a>
      {compact ? (
        // At phone width the sidebar is a modal drawer: focus stays inside, Escape closes it.
        <Sheet open={drawerOpen} onOpenChange={(open) => useUiStore.getState().setDrawerOpen(open)}>
          <SheetContent side="left" title={t('sidebar')}>
            <Sidebar />
          </SheetContent>
        </Sheet>
      ) : sidebarOpen ? (
        <Sidebar resizable />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          <Routes>
            <Route index element={<HomeView />} />
            <Route path="p/:pageId" element={<PageView />} />
            <Route
              path="trash"
              element={
                <Suspense fallback={<ViewLoading />}>
                  <TrashView />
                </Suspense>
              }
            />
            <Route
              path="settings/*"
              element={
                <Suspense fallback={<ViewLoading />}>
                  <SettingsView />
                </Suspense>
              }
            />
            {routes.map((route) => {
              const Component = route.component;
              return (
                <Route
                  key={`${route.featureId}:${route.path}`}
                  path={route.path.replace(/^\//, '')}
                  element={
                    <FeatureBoundary featureId={route.featureId} className="m-6">
                      <Suspense fallback={<ViewLoading />}>
                        <Component />
                      </Suspense>
                    </FeatureBoundary>
                  }
                />
              );
            })}
            <Route path="*" element={<NotFoundView />} />
          </Routes>
        </main>
      </div>
      {compact ? (
        // At phone width a side panel covers the page as a modal sheet.
        <Sheet
          open={sidePanel !== null}
          onOpenChange={(open) => (open ? undefined : useUiStore.getState().setSidePanel(null))}
        >
          <SheetContent side="right" title={t('panels')} className="w-full">
            {sidePanel ? <SidePanelHost panelId={sidePanel} /> : null}
          </SheetContent>
        </Sheet>
      ) : sidePanel ? (
        <div className="w-[var(--tess-panel-width)] shrink-0 animate-slide-in-right border-l border-border">
          <SidePanelHost panelId={sidePanel} />
        </div>
      ) : null}
      <ShortcutsDialog />
    </div>
  );
}
