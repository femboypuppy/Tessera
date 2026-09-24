import { colorForId, isDocEmpty, type DocJSON, type SidePanelProps } from '@tessera/core';
import { useAppContext, useContributions, usePages } from '@tessera/core/react';
import {
  Avatar,
  Badge,
  Button,
  Callout,
  EmptyState,
  FeatureBoundary,
  Input,
  Skeleton,
  Spinner,
  getLocale,
} from '@tessera/ui';
import { ArrowLeft, History, RotateCcw, Save } from 'lucide-react';
import { Suspense, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  historyServiceOf,
  type HistoryService,
  type ListedVersion,
} from '../../history/history-service';
import { contentOf } from '../../history/snapshots';
import { t } from '../../i18n';
import { useAsync, useWorkspaceSyncStatus } from '../hooks';
import { errorMessage, LoadError } from '../settings/parts';
import { DocPreview } from './DocPreview';

function dayLabel(time: number, now: number): string {
  const day = (value: number) => new Date(value).toDateString();
  if (day(time) === day(now)) return t('today');
  if (day(time) === day(now - 86_400_000)) return t('yesterday');
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(time);
}

function timeLabel(time: number): string {
  return new Intl.DateTimeFormat(getLocale(), { timeStyle: 'short' }).format(time);
}

function kindBadge(version: ListedVersion) {
  if (version.kind === 'manual') return <Badge tone="accent">{t('manualVersion')}</Badge>;
  if (version.kind === 'restore') return <Badge tone="warning">{t('restoreVersionKind')}</Badge>;
  return <Badge>{t('autoVersion')}</Badge>;
}

function SaveVersionForm({ service, pageId }: { service: HistoryService; pageId: string }) {
  const ctx = useAppContext();
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await service.saveVersion(pageId, { kind: 'manual', label });
      ctx.toast({ variant: 'success', title: t('versionSaved') });
      setLabel('');
      setOpen(false);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <Button size="sm" className="w-full" onClick={() => setOpen(true)}>
        <Save aria-hidden="true" />
        {t('saveVersion')}
      </Button>
    );
  }
  return (
    <form
      aria-label={t('saveVersionTitle')}
      className="flex flex-col gap-2"
      onSubmit={(event) => void save(event)}
    >
      <label className="flex flex-col gap-1.5 text-ui font-medium text-fg">
        {t('versionLabel')}
        <Input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder={t('versionLabelPlaceholder')}
          maxLength={200}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- the field appears on request
          autoFocus
        />
      </label>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('cancel')}
        </Button>
        <Button size="sm" type="submit" variant="primary" loading={busy}>
          {t('saveVersion')}
        </Button>
      </div>
    </form>
  );
}

function VersionList({
  versions,
  onSelect,
}: {
  versions: ListedVersion[];
  onSelect(version: ListedVersion): void;
}) {
  const now = Date.now();
  const groups = useMemo(() => {
    const result: Array<{ label: string; items: ListedVersion[] }> = [];
    for (const version of versions) {
      const label = dayLabel(version.createdAt, now);
      const last = result[result.length - 1];
      if (last?.label === label) last.items.push(version);
      else result.push({ label, items: [version] });
    }
    return result;
  }, [versions, now]);
  return (
    <div className="flex flex-col gap-4">
      {groups.map((group) => (
        <section key={group.label} aria-label={group.label}>
          <h3 className="mb-1 px-2 text-xs font-medium text-fg-subtle">{group.label}</h3>
          <ul className="flex flex-col">
            {group.items.map((version) => (
              <li key={version.id}>
                <button
                  type="button"
                  onClick={() => onSelect(version)}
                  className="duration-fast flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus"
                >
                  <Avatar
                    name={version.authorName ?? t('someone')}
                    color={version.createdBy ? colorForId(version.createdBy) : undefined}
                    size="sm"
                    className="mt-0.5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-sm font-medium text-fg">
                        {timeLabel(version.createdAt)}
                      </span>
                      {kindBadge(version)}
                    </span>
                    {version.label ? (
                      <span className="block truncate text-ui text-fg">{version.label}</span>
                    ) : null}
                    <span className="block truncate text-xs text-fg-muted">
                      {t('versionBy', { name: version.authorName ?? t('someone') })}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function VersionPreview({
  service,
  pageId,
  version,
  canRestore,
  onBack,
  onRestored,
}: {
  service: HistoryService;
  pageId: string;
  version: ListedVersion;
  canRestore: boolean;
  onBack(): void;
  onRestored(): void;
}) {
  const ctx = useAppContext();
  const content = useAsync(
    async () => contentOf(await service.stateOf(version)),
    [service, version.id],
  );
  const [busy, setBusy] = useState(false);

  const restore = async () => {
    const confirmed = await ctx.confirm({
      title: t('restoreConfirm'),
      description: t('restoreConfirmHint'),
      confirmLabel: t('restore'),
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const restored = await service.restore(pageId, version);
      // Undo is offered while the toast shows; the "before restore" version stays afterwards.
      const release = setTimeout(() => restored.dispose(), 30_000);
      ctx.toast({
        variant: 'success',
        title: t('restored'),
        durationMs: 12_000,
        action: {
          label: t('undo'),
          onClick: () => {
            clearTimeout(release);
            if (restored.undo()) ctx.toast({ title: t('restoreUndone') });
            restored.dispose();
          },
        },
      });
      onRestored();
    } catch (caught) {
      ctx.toast({ variant: 'error', title: t('restoreFailed', { message: errorMessage(caught) }) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border p-3">
        <Button size="sm" variant="ghost" className="self-start" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />
          {t('backToList')}
        </Button>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
              {new Intl.DateTimeFormat(getLocale(), {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(version.createdAt)}
              {kindBadge(version)}
            </p>
            {version.label ? <p className="text-ui text-fg">{version.label}</p> : null}
            <p className="text-xs text-fg-muted">
              {t('versionBy', { name: version.authorName ?? t('someone') })}
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            loading={busy}
            disabled={!canRestore || content.status !== 'ready'}
            onClick={() => void restore()}
          >
            <RotateCcw aria-hidden="true" />
            {t('restore')}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4" aria-label={t('preview')} role="region">
        {content.status === 'loading' ? (
          <div className="flex flex-col gap-2" aria-hidden="true">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ) : null}
        {content.status === 'error' ? (
          <LoadError error={content.error} onRetry={content.reload} />
        ) : null}
        {content.status === 'ready' ? (
          <VersionContent doc={content.data.doc} pageId={pageId} />
        ) : null}
      </div>
    </div>
  );
}

const previewSkeleton = (
  <div className="flex flex-col gap-2" aria-hidden="true">
    <Skeleton className="h-6 w-2/3" />
    <Skeleton className="h-4 w-full" />
    <Skeleton className="h-4 w-5/6" />
  </div>
);

/**
 * A version's content, read-only: through the editor's `docViewers` contribution (the same blocks
 * as the page) when there is one, else this package's plain renderer.
 */
export function VersionContent({ doc, pageId }: { doc: DocJSON; pageId: string }) {
  const [viewer] = useContributions('docViewers');
  if (isDocEmpty(doc)) return <p className="text-ui text-fg-subtle italic">{t('emptyPage')}</p>;
  if (!viewer) return <DocPreview doc={doc} />;
  const Viewer = viewer.component;
  return (
    <FeatureBoundary featureId={viewer.featureId} resetKeys={[pageId]}>
      <Suspense fallback={previewSkeleton}>
        <Viewer doc={doc} pageId={pageId} />
      </Suspense>
    </FeatureBoundary>
  );
}

/** The version history of the open page: list, preview and restore. */
export function HistoryPanel({ pageId, page }: SidePanelProps) {
  const ctx = useAppContext();
  const service = historyServiceOf(ctx);
  const pages = usePages();
  const status = useWorkspaceSyncStatus();
  const [version, setVersion] = useState(0);
  const [selected, setSelected] = useState<ListedVersion | null>(null);
  const list = useAsync(
    () => (service && pageId ? service.list(pageId) : Promise.resolve(null)),
    [service, pageId, version],
  );
  useEffect(() => {
    setSelected(null);
  }, [pageId]);
  useEffect(() => {
    if (!service) return undefined;
    return service.onChange((changed) => {
      if (changed === pageId) setVersion((value) => value + 1);
    });
  }, [service, pageId]);

  if (!pageId || !page) return <EmptyState icon={<History />} title={t('historyTitle')} />;
  if (page.kind !== 'page')
    return <EmptyState icon={<History />} title={t('historyNotForDatabases')} />;
  if (service === undefined)
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  if (service === null) return <EmptyState icon={<History />} title={t('historyUnavailable')} />;
  const canRestore = !pages.isTrashed(pageId) && !status.readOnly;

  if (selected) {
    return (
      <VersionPreview
        service={service}
        pageId={pageId}
        version={selected}
        canRestore={canRestore}
        onBack={() => setSelected(null)}
        onRestored={() => {
          setSelected(null);
          setVersion((value) => value + 1);
        }}
      />
    );
  }
  const versions = list.data?.versions ?? [];
  return (
    <div className="flex flex-col gap-3 p-3">
      {canRestore ? <SaveVersionForm service={service} pageId={pageId} /> : null}
      {list.data && !list.data.serverAvailable ? (
        <Callout tone="info">{t('historyOfflineNote')}</Callout>
      ) : null}
      {list.status === 'loading' && !list.data ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : null}
      {list.status === 'error' ? <LoadError error={list.error} onRetry={list.reload} /> : null}
      {list.status === 'ready' && versions.length === 0 ? (
        <EmptyState
          icon={<History />}
          title={t('historyEmpty')}
          description={t('historyEmptyHint')}
          className="py-8"
        />
      ) : null}
      {versions.length > 0 ? <VersionList versions={versions} onSelect={setSelected} /> : null}
    </div>
  );
}
