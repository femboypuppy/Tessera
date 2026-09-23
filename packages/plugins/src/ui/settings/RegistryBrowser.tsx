import { useAppContext } from '@tessera/core/react';
import { useSetting } from '@tessera/core/react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  IconButton,
  Input,
  Skeleton,
} from '@tessera/ui';
import { AlertTriangle, Check, ExternalLink, Search, Settings2, SearchX } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { parseInstallUrl } from '../../bundle';
import { DEFAULT_REGISTRY_URL, PLUGIN_SETTING_KEYS } from '../../constants';
import { t } from '../../i18n';
import { describePermission } from '../../manifest';
import {
  fetchRegistry,
  hasUpdate,
  searchRegistry,
  type Registry,
  type RegistryEntry,
} from '../../registry';
import type { InstalledPlugin } from '../../store/types';
import { PermissionIcon, PluginIcon } from './parts';

/** Registries loaded this session, so switching tabs doesn't refetch. */
const cache = new Map<string, { registry: Registry; at: number }>();
const CACHE_MS = 5 * 60_000;

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; registry: Registry }
  | { state: 'error'; message: string };

function useRegistry(url: string, attempt: number): LoadState {
  const cached = cache.get(url);
  const [load, setLoad] = useState<LoadState>(() =>
    cached && Date.now() - cached.at < CACHE_MS
      ? { state: 'ready', registry: cached.registry }
      : { state: 'loading' },
  );
  useEffect(() => {
    const hit = cache.get(url);
    if (attempt === 0 && hit && Date.now() - hit.at < CACHE_MS) {
      setLoad({ state: 'ready', registry: hit.registry });
      return undefined;
    }
    const controller = new AbortController();
    setLoad({ state: 'loading' });
    fetchRegistry(url, { signal: controller.signal }).then(
      (registry) => {
        cache.set(url, { registry, at: Date.now() });
        setLoad({ state: 'ready', registry });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        setLoad({
          state: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      },
    );
    return () => controller.abort();
  }, [url, attempt]);
  return load;
}

function RegistryUrlDialog({
  open,
  value,
  onClose,
  onSave,
}: {
  open: boolean;
  value: string;
  onClose(): void;
  onSave(url: string | undefined): void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) setDraft(value);
  }, [open, value]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const url = parseInstallUrl(draft);
    if (!url) {
      setError(t('invalidUrl'));
      return;
    }
    setError(null);
    onSave(url.href === DEFAULT_REGISTRY_URL ? undefined : url.href);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>{t('changeRegistry')}</DialogTitle>
            <DialogDescription>{t('registryUrlHint')}</DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field label={t('registryUrlLabel')} error={error ?? undefined}>
              {(props) => (
                <Input
                  {...props}
                  type="url"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={() => onSave(undefined)}>
              {t('useDefaultRegistry')}
            </Button>
            <div className="flex gap-2">
              <Button onClick={onClose}>{t('cancel')}</Button>
              <Button type="submit" variant="primary">
                {t('save')}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RegistryCard({
  entry,
  installed,
  pending,
  onInstall,
  onOpen,
}: {
  entry: RegistryEntry;
  installed: InstalledPlugin | undefined;
  pending: boolean;
  onInstall(): void;
  onOpen(): void;
}) {
  const update = installed && hasUpdate(entry, installed.manifest.version);
  return (
    <li
      className="duration-fast flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 transition-shadow hover:shadow-subtle"
      data-registry-id={entry.id}
    >
      <div className="flex items-start gap-3">
        <PluginIcon icon={entry.icon} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-fg">{entry.name}</h3>
          <p className="truncate text-xs text-fg-muted">
            {t('byAuthor', { author: entry.author })} · {t('version', { version: entry.version })}
          </p>
        </div>
        {installed && !update ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpen}
            aria-label={t('openDetails', { plugin: entry.name })}
          >
            <Check aria-hidden="true" className="text-success-text" />
            {t('installedBadge')}
          </Button>
        ) : (
          <Button
            size="sm"
            variant={update ? 'secondary' : 'primary'}
            loading={pending}
            onClick={onInstall}
            aria-label={
              update
                ? `${t('updateTo', { version: entry.version })}: ${entry.name}`
                : `${t('install')} ${entry.name}`
            }
          >
            {update ? t('updateTo', { version: entry.version }) : t('install')}
          </Button>
        )}
      </div>
      <p className="line-clamp-3 min-h-10 text-ui text-fg-muted">{entry.description}</p>
      <div className="mt-auto flex items-center justify-between gap-2">
        <ul className="flex flex-wrap items-center gap-1" aria-label={t('tabPermissions')}>
          {entry.permissions.map((permission) => (
            <li key={permission}>
              <span
                role="img"
                title={describePermission(permission).title}
                aria-label={describePermission(permission).title}
                className="flex size-6 items-center justify-center rounded-md bg-hover text-fg-muted"
              >
                <PermissionIcon permission={permission} className="size-3.5" />
              </span>
            </li>
          ))}
          {entry.tags?.slice(0, 3).map((tag) => (
            <li key={tag}>
              <Badge>{tag}</Badge>
            </li>
          ))}
        </ul>
        <IconButton
          asChild
          size="sm"
          label={t('viewSource', { plugin: entry.name })}
          icon={
            <a href={entry.repo} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
            </a>
          }
        />
      </div>
    </li>
  );
}

/** Browse and search the community registry, and install from it. */
export function RegistryBrowser({
  installed,
  query,
  onQueryChange,
  pendingId,
  onInstall,
  onOpen,
}: {
  installed: readonly InstalledPlugin[];
  query: string;
  onQueryChange(query: string): void;
  pendingId: string | null;
  onInstall(entry: RegistryEntry, registryUrl: string): void;
  onOpen(id: string): void;
}) {
  const ctx = useAppContext();
  const [storedUrl, setStoredUrl] = useSetting<string>(
    ctx.settings.device,
    PLUGIN_SETTING_KEYS.registryUrl,
    DEFAULT_REGISTRY_URL,
  );
  const url = parseInstallUrl(storedUrl)?.href ?? DEFAULT_REGISTRY_URL;
  const [attempt, setAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const load = useRegistry(url, attempt);
  const results = useMemo(
    () => (load.state === 'ready' ? searchRegistry(load.registry.plugins, query) : []),
    [load, query],
  );
  const byId = new Map(installed.map((plugin) => [plugin.id, plugin]));
  let host = url;
  try {
    host = new URL(url).host;
  } catch {
    // Keep the raw URL.
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle"
            aria-hidden="true"
          />
          <Input
            type="search"
            aria-label={t('searchPlugins')}
            placeholder={t('searchPlaceholder')}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            className="pl-8"
          />
        </div>
        <div className="flex min-w-0 items-center gap-1 text-xs text-fg-subtle">
          <span className="truncate" title={url}>
            {t('registryFrom', { url: host })}
          </span>
          <IconButton
            size="sm"
            label={t('changeRegistry')}
            icon={<Settings2 />}
            onClick={() => setEditing(true)}
          />
        </div>
      </div>

      {load.state === 'loading' ? (
        <ul className="grid gap-3 md:grid-cols-2" aria-busy="true" aria-label={t('searchPlugins')}>
          {[0, 1, 2, 3].map((index) => (
            <li key={index} className="flex flex-col gap-3 rounded-xl border border-border p-4">
              <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-lg" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-3.5 w-1/3" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
              </div>
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </li>
          ))}
        </ul>
      ) : load.state === 'error' ? (
        <EmptyState
          tone="danger"
          icon={<AlertTriangle />}
          title={t('registryErrorTitle')}
          description={load.message}
          actions={<Button onClick={() => setAttempt((value) => value + 1)}>{t('retry')}</Button>}
        />
      ) : results.length === 0 ? (
        <EmptyState
          icon={<SearchX />}
          title={query ? t('noResults', { query }) : t('registryEmpty')}
        />
      ) : (
        <>
          <ul className="grid gap-3 md:grid-cols-2">
            {results.map((entry) => (
              <RegistryCard
                key={entry.id}
                entry={entry}
                installed={byId.get(entry.id)}
                pending={pendingId === entry.id}
                onInstall={() => onInstall(entry, url)}
                onOpen={() => onOpen(entry.id)}
              />
            ))}
          </ul>
          {load.registry.skipped ? (
            <p className="text-xs text-fg-subtle">
              {t('registrySkipped', { count: load.registry.skipped })}
            </p>
          ) : null}
        </>
      )}
      <RegistryUrlDialog
        open={editing}
        value={url}
        onClose={() => setEditing(false)}
        onSave={(next) => {
          setStoredUrl(next);
          setEditing(false);
          setAttempt((value) => value + 1);
        }}
      />
    </div>
  );
}
