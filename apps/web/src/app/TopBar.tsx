import { formatShortcut, SETTING_KEYS, type AppContext, type PageMeta } from '@tessera/core';
import { useAncestors, useAppContext, useContributions, usePage } from '@tessera/core/react';
import {
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  FeatureBoundary,
  IconButton,
  useIsCompact,
} from '@tessera/ui';
import { Copy, Link2, Menu, MoreHorizontal, PanelLeft, Star, StarOff, Trash2 } from 'lucide-react';
import { Fragment } from 'react';
import { useLocation } from 'react-router';
import { t } from '../i18n';
import { displayTitle, PageIcon, pageUrl, trashWithUndo } from './page-helpers';
import { useUiStore } from './ui-store';

function Crumb({ page, current, ctx }: { page: PageMeta; current: boolean; ctx: AppContext }) {
  return (
    <button
      type="button"
      aria-current={current ? 'page' : undefined}
      onClick={() => ctx.navigate(page.id)}
      className={cn(
        'duration-fast flex h-7 max-w-[14rem] min-w-0 items-center gap-1.5 rounded-md px-1.5 text-sm transition-colors hover:bg-hover',
        current ? 'text-fg' : 'text-fg-muted',
      )}
    >
      <PageIcon page={page} />
      <span className="truncate">{displayTitle(page)}</span>
    </button>
  );
}

function Breadcrumbs({ page }: { page: PageMeta }) {
  const ctx = useAppContext();
  const ancestors = useAncestors(page.id);
  // Deep trails keep the root and the last two ancestors: Root / … / Parent / Page.
  const shown = ancestors.length > 3 ? [ancestors[0], null, ...ancestors.slice(-2)] : ancestors;
  return (
    <nav aria-label={t('breadcrumbs')} className="min-w-0">
      <ol className="flex min-w-0 items-center">
        {shown.map((ancestor, index) => (
          <Fragment key={ancestor?.id ?? `gap-${index}`}>
            <li className="flex min-w-0 items-center">
              {ancestor ? (
                <Crumb page={ancestor} current={false} ctx={ctx} />
              ) : (
                <span className="px-1 text-fg-subtle">…</span>
              )}
            </li>
            <li aria-hidden="true" className="px-0.5 text-fg-subtle">
              /
            </li>
          </Fragment>
        ))}
        <li className="flex min-w-0 items-center">
          <Crumb page={page} current ctx={ctx} />
        </li>
      </ol>
    </nav>
  );
}

function PageMenu({ page }: { page: PageMeta }) {
  const ctx = useAppContext();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label={t('pageActions')} icon={<MoreHorizontal />} tooltip={false} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem
          icon={page.favorite ? <StarOff /> : <Star />}
          onSelect={() => ctx.workspace.setFavorite(page.id, !page.favorite)}
        >
          {page.favorite ? t('removeFromFavorites') : t('addToFavorites')}
        </DropdownMenuItem>
        <DropdownMenuItem
          icon={<Link2 />}
          onSelect={() => {
            void navigator.clipboard
              ?.writeText(pageUrl(page.id))
              .then(() => ctx.toast({ title: t('linkCopied') }));
          }}
        >
          {t('copyLink')}
        </DropdownMenuItem>
        {page.kind === 'page' && !ctx.workspace.pages.getSnapshot().isRow(page.id) ? (
          <DropdownMenuItem
            icon={<Copy />}
            onSelect={() => {
              void ctx.workspace.duplicatePage(page.id).then((copy) => ctx.navigate(copy.id));
            }}
          >
            {t('duplicate')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          icon={<Trash2 />}
          destructive
          onSelect={() => trashWithUndo(ctx, page.id)}
        >
          {t('moveToTrash')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PanelToggles({ page }: { page: PageMeta }) {
  const ctx = useAppContext();
  const panels = useContributions('pageSidePanels').filter(
    (panel) => !panel.when || panel.when(page, ctx),
  );
  const open = useUiStore((state) => state.sidePanel);
  const setPanel = useUiStore((state) => state.setSidePanel);
  if (panels.length === 0) return null;
  if (panels.length > 3) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton
            label={t('panels')}
            icon={<PanelLeft className="scale-x-[-1]" />}
            tooltip={false}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{t('panels')}</DropdownMenuLabel>
          {panels.map((panel) => {
            const Icon = panel.icon;
            return (
              <DropdownMenuItem
                key={panel.id}
                icon={Icon ? <Icon /> : undefined}
                onSelect={() => setPanel(open === panel.id ? null : panel.id)}
              >
                {panel.title}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
  return (
    <>
      {panels.map((panel) => {
        const Icon = panel.icon ?? PanelLeft;
        return (
          <IconButton
            key={panel.id}
            label={panel.title}
            icon={<Icon />}
            aria-pressed={open === panel.id}
            onClick={() => setPanel(open === panel.id ? null : panel.id)}
          />
        );
      })}
    </>
  );
}

function RouteTitle() {
  const location = useLocation();
  const title = location.pathname.startsWith('/trash')
    ? t('trash')
    : location.pathname.startsWith('/settings')
      ? t('settings')
      : null;
  return title ? (
    <span className="truncate px-1.5 text-sm font-medium text-fg">{title}</span>
  ) : null;
}

/** The bar above the main view: sidebar toggle, breadcrumbs, feature items and page actions. */
export function TopBar() {
  const ctx = useAppContext();
  const compact = useIsCompact();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const pageId = useUiStore((state) => state.currentPageId);
  const page = usePage(pageId);
  const items = useContributions('topBarItems');
  const headerActions = useContributions('pageHeaderActions');
  const showToggle = compact || !sidebarOpen;
  return (
    <header className="flex h-[var(--tess-topbar-height)] shrink-0 items-center gap-1 px-2">
      {showToggle ? (
        <IconButton
          label={t('expandSidebar')}
          icon={compact ? <Menu /> : <PanelLeft />}
          shortcut={formatShortcut('Mod+\\', ctx.platform.isApple)}
          onClick={() => {
            if (compact) useUiStore.getState().setDrawerOpen(true);
            else {
              useUiStore.getState().setSidebarOpen(true);
              ctx.settings.device.set(SETTING_KEYS.sidebarOpen, true);
            }
          }}
        />
      ) : null}
      <div className="flex min-w-0 flex-1 items-center">
        {page ? <Breadcrumbs page={page} /> : <RouteTitle />}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {items.map((item) => {
          const Component = item.component;
          return (
            <FeatureBoundary
              key={`${item.featureId}:${item.id}`}
              featureId={item.featureId}
              className="p-1"
            >
              <Component />
            </FeatureBoundary>
          );
        })}
        {page
          ? headerActions
              .filter((action) => !action.when || action.when(page, ctx))
              .map((action) => {
                const Component = action.component;
                return (
                  <FeatureBoundary
                    key={`${action.featureId}:${action.id}`}
                    featureId={action.featureId}
                    className="p-1"
                  >
                    <Component pageId={page.id} page={page} readOnly={false} />
                  </FeatureBoundary>
                );
              })
          : null}
        {page ? (
          <>
            <IconButton
              label={page.favorite ? t('removeFromFavorites') : t('addToFavorites')}
              icon={<Star className={cn(page.favorite && 'fill-current text-warning')} />}
              aria-pressed={page.favorite === true}
              // The filled star shows the state; a pressed background on top of it is too loud.
              className="aria-pressed:bg-transparent aria-pressed:hover:bg-hover"
              onClick={() => ctx.workspace.setFavorite(page.id, !page.favorite)}
            />
            <PanelToggles page={page} />
            <PageMenu page={page} />
          </>
        ) : null}
      </div>
    </header>
  );
}
