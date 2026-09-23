import { getPageProps, observePageProps, type PageMeta } from '@tessera/core';
import { useAppContext, useContributions, usePageDoc, usePages } from '@tessera/core/react';
import { Button, cn, EmptyState, FeatureBoundary, Skeleton } from '@tessera/ui';
import { Blocks, FileQuestion, RotateCcw, Trash2 } from 'lucide-react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { t } from '../../i18n';
import type { NavigationTarget } from '../bridge';
import { displayTitle } from '../page-helpers';
import { PageCoverBand, PageHeader, focusPageTitle } from './PageHeader';

export { focusPageTitle };

/** Display props (`fullWidth`, `smallText`) from the page doc; the editor toggles them. */
function useDisplayProps(pageId: string): { fullWidth: boolean; smallText: boolean } {
  const { handle, loaded } = usePageDoc(pageId);
  const [props, setProps] = useState({ fullWidth: false, smallText: false });
  useEffect(() => {
    if (!handle || !loaded) return undefined;
    const read = () => {
      const current = getPageProps(handle.doc);
      setProps({ fullWidth: current.fullWidth === true, smallText: current.smallText === true });
    };
    read();
    return observePageProps(handle.doc, read);
  }, [handle, loaded]);
  return props;
}

function TrashBanner({ page }: { page: PageMeta }) {
  const ctx = useAppContext();
  const navigate = useNavigate();
  const snapshot = usePages();
  // The page may be in the trash through an ancestor; restore the page that was trashed.
  const trashedRoot =
    [page, ...[...snapshot.ancestors(page.id)].reverse()].find(
      (candidate) => candidate.trashedAt !== undefined,
    ) ?? page;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 bg-danger px-4 py-2 text-sm text-danger-fg"
    >
      <span>{t('pageInTrash')}</span>
      <Button
        size="sm"
        variant="subtle"
        className="bg-white/15 text-danger-fg hover:bg-white/25"
        onClick={() => ctx.workspace.restorePage(trashedRoot.id)}
      >
        <RotateCcw aria-hidden="true" />
        {t('restore')}
      </Button>
      <Button
        size="sm"
        variant="subtle"
        className="bg-white/15 text-danger-fg hover:bg-white/25"
        onClick={() => {
          void ctx
            .confirm({
              title: t('deleteForeverConfirm', { title: displayTitle(trashedRoot) }),
              description: t('deleteForeverConfirmHint'),
              confirmLabel: t('deleteForever'),
              destructive: true,
            })
            .then(async (confirmed) => {
              if (!confirmed) return;
              // Leave first, so the view never renders the deleted page as "not found".
              void navigate('/trash');
              await ctx.workspace.deletePagePermanently(trashedRoot.id);
            });
        }}
      >
        <Trash2 aria-hidden="true" />
        {t('deleteForever')}
      </Button>
    </div>
  );
}

function PageBody({
  page,
  readOnly,
  target,
  registerFocusHandler,
}: {
  page: PageMeta;
  readOnly: boolean;
  target: NavigationTarget | null;
  registerFocusHandler: (handler: (position: 'start' | 'end') => void) => () => void;
}) {
  const bodies = useContributions('pageBodies');
  const body = bodies.find((candidate) => candidate.kind === page.kind);
  if (!body) {
    return (
      <EmptyState
        className="mt-8 rounded-xl border border-dashed border-border"
        icon={<Blocks />}
        title={t('noBodyTitle')}
        description={t('noBodyHint', {
          kind: page.kind === 'database' ? t('kindDatabase') : t('kindPage'),
        })}
      />
    );
  }
  const Body = body.component;
  return (
    <FeatureBoundary featureId={body.featureId} resetKeys={[page.id]} className="mt-6">
      <Suspense
        fallback={
          <div className="mt-6 flex flex-col gap-3" aria-busy="true" aria-label={t('loadingPage')}>
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        }
      >
        <Body
          pageId={page.id}
          page={page}
          readOnly={readOnly}
          target={target}
          focusTitle={(position = 'end') => focusPageTitle(position)}
          registerFocusHandler={registerFocusHandler}
        />
      </Suspense>
    </FeatureBoundary>
  );
}

/**
 * A page: cover, icon, title, top sections (such as database row properties) and the body the
 * feature for its kind provides (the editor for pages, the databases feature for databases).
 */
export function PageView() {
  const { pageId = '' } = useParams();
  const ctx = useAppContext();
  const location = useLocation();
  const snapshot = usePages();
  const page = snapshot.get(pageId);
  const topSections = useContributions('pageTopSections');
  const display = useDisplayProps(pageId);
  const bodyFocus = useRef<((position: 'start' | 'end') => void) | null>(null);
  const state = location.state as { focusTitle?: boolean; target?: NavigationTarget } | null;

  const registerFocusHandler = useCallback((handler: (position: 'start' | 'end') => void) => {
    bodyFocus.current = handler;
    return () => {
      if (bodyFocus.current === handler) bodyFocus.current = null;
    };
  }, []);
  const focusBody = useCallback((position: 'start' | 'end') => {
    if (!bodyFocus.current) return false;
    bodyFocus.current(position);
    return true;
  }, []);

  useEffect(() => {
    document.title = page ? `${displayTitle(page)} · ${t('appName')}` : t('appName');
  }, [page]);

  if (!page) {
    return (
      <EmptyState
        className="mt-24"
        icon={<FileQuestion />}
        title={t('pageNotFound')}
        description={t('pageNotFoundHint')}
        actions={<Button onClick={() => ctx.navigateTo('/')}>{t('goHome')}</Button>}
      />
    );
  }

  const trashed = snapshot.isTrashed(page.id);
  const readOnly = trashed;
  const sections = topSections.filter((section) => !section.when || section.when(page, ctx));

  return (
    <article
      aria-label={displayTitle(page)}
      data-full-width={display.fullWidth || undefined}
      data-small-text={display.smallText || undefined}
      className="group/page pb-[40vh]"
    >
      {trashed ? <TrashBanner page={page} /> : null}
      <PageCoverBand page={page} readOnly={readOnly} />
      <div
        className={cn(
          'mx-auto w-full px-4 md:px-[var(--tess-page-padding)]',
          display.fullWidth
            ? 'max-w-none'
            : 'max-w-[calc(var(--tess-page-width)+2*var(--tess-page-padding))]',
        )}
      >
        <PageHeader
          page={page}
          readOnly={readOnly}
          onFocusBody={focusBody}
          autoFocusTitle={state?.focusTitle === true}
        />
        {sections.map((section) => {
          const Section = section.component;
          return (
            <FeatureBoundary
              key={`${section.featureId}:${section.id}`}
              featureId={section.featureId}
              resetKeys={[page.id]}
              className="mt-4"
            >
              <Section pageId={page.id} page={page} readOnly={readOnly} />
            </FeatureBoundary>
          );
        })}
        <PageBody
          page={page}
          readOnly={readOnly}
          target={state?.target ?? null}
          registerFocusHandler={registerFocusHandler}
        />
      </div>
    </article>
  );
}
