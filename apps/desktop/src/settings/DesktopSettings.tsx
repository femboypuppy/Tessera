import { toError } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  Callout,
  getLocale,
  KeyCombo,
  Label,
  Separator,
  Skeleton,
  Spinner,
  Switch,
} from '@tessera/ui';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';
import type { Prefs, ServerEntry } from '../backend/protocol';
import { t } from '../i18n';
import { revealLabel } from '../lib/paths';
import { acceleratorFromEvent, formatAccelerator } from '../lib/shortcut';
import { useStore } from '../lib/store';
import { currentMirror } from '../mirror/mirror';
import { getBackend } from '../runtime';
import { checkForUpdates, installUpdate, RELEASES_URL, updateStore } from '../updates/updates';
import { providerName } from '../workspace/flows';
import { folderStatusStore, refreshFolderStatus } from '../workspace/status';

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-semibold text-fg">{title}</h3>
        {description ? <p className="mt-0.5 text-ui text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label htmlFor={id}>{label}</Label>
        {description ? (
          <p id={`${id}-description`} className="mt-0.5 text-ui text-fg-muted">
            {description}
          </p>
        ) : null}
      </div>
      <Switch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        aria-describedby={description ? `${id}-description` : undefined}
      />
    </div>
  );
}

function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return format.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  return format.format(Math.round(minutes / 60), 'hour');
}

/** Settings → Desktop. */
export default function DesktopSettings() {
  return (
    <div className="flex flex-col gap-8">
      <FolderSection />
      <Separator />
      <MirrorSection />
      <Separator />
      <CaptureAndWindowSections />
      <Separator />
      <UpdatesSection />
      <Separator />
      <ServersSection />
    </div>
  );
}

function FolderSection() {
  const ctx = useAppContext();
  const backend = getBackend();
  const status = useStore(folderStatusStore);
  const [merging, setMerging] = useState<string | null>(null);
  const workspace = ctx.workspace.info;

  useEffect(() => {
    void refreshFolderStatus(backend, workspace.id);
  }, [backend, workspace.id]);

  const merge = async (file: string) => {
    setMerging(file);
    try {
      const report = await backend.mergeConflict(workspace.id, file);
      ctx.toast({
        variant: 'success',
        title: t('mergedToast', { file }),
        description: t('mergedDetails', { count: report.updates }),
      });
      // Reopen so every open doc loads the merged updates.
      ctx.switchWorkspace(workspace.id);
    } catch (error) {
      ctx.toast({
        variant: 'error',
        title: t('mergeFailed', { file }),
        description: toError(error).message,
      });
      setMerging(null);
      void refreshFolderStatus(backend, workspace.id);
    }
  };

  return (
    <Section title={t('folderSection')} description={t('folderSectionDescription')}>
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-bg-subtle px-3 py-2.5">
        <FolderOpen className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-ui text-fg" title={workspace.path}>
            {workspace.path}
          </p>
          <p className="text-xs text-fg-subtle">
            {status && !status.exists ? t('folderNotCreated') : t('storageDetails')}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() =>
            void backend.revealFolder(workspace.path ?? '').catch((error: unknown) =>
              ctx.toast({
                variant: 'error',
                title: t('openFailed'),
                description: toError(error).message,
              }),
            )
          }
        >
          {revealLabel(ctx.platform.os)}
        </Button>
      </div>
      {status?.cloud ? (
        <Callout
          tone="warning"
          title={t('cloudWarningTitle', { provider: providerName(status.cloud.provider) })}
        >
          {t('cloudWarningBody', { provider: providerName(status.cloud.provider) })}
        </Callout>
      ) : null}
      {status && status.conflicts.length > 0 ? (
        <Callout tone="danger" title={t('conflictsTitle')}>
          <p>{t('conflictsBody')}</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {status.conflicts.map((file) => (
              <li key={file} className="flex items-center justify-between gap-3">
                <span className="truncate font-mono text-xs text-fg">{file}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={merging === file}
                  disabled={merging !== null}
                  onClick={() => void merge(file)}
                >
                  {merging === file ? t('merging') : t('merge')}
                </Button>
              </li>
            ))}
          </ul>
        </Callout>
      ) : null}
    </Section>
  );
}

function MirrorSection() {
  const ctx = useAppContext();
  const backend = getBackend();
  const mirror = useStore(currentMirror);
  const folder = useStore(folderStatusStore);
  if (!mirror) return null;
  return (
    <MirrorControls
      key={ctx.workspace.info.id}
      mirror={mirror}
      exists={folder?.exists ?? true}
      onReveal={() => {
        const path = ctx.workspace.info.path;
        if (path)
          void backend
            .revealFolder(`${path}${path.includes('\\') ? '\\' : '/'}markdown`)
            .catch(() => undefined);
      }}
    />
  );
}

function MirrorControls({
  mirror,
  exists,
  onReveal,
}: {
  mirror: NonNullable<ReturnType<typeof currentMirror.get>>;
  exists: boolean;
  onReveal: () => void;
}) {
  const status = useStore(mirror.status);
  return (
    <Section title={t('mirrorSection')}>
      <SwitchRow
        label={t('mirrorToggle')}
        description={
          exists ? t('mirrorDescription') : `${t('mirrorDescription')} ${t('mirrorNeedsFolder')}`
        }
        checked={status.enabled}
        onChange={(checked) => void mirror.setEnabled(checked)}
      />
      {status.enabled ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-ui text-fg-muted" role="status">
            {status.running ? (
              <>
                <Spinner className="size-3.5" />
                {t('mirrorRunning')}
              </>
            ) : status.error ? (
              <span className="text-danger-text">
                {t('mirrorFailed', { message: status.error })}
              </span>
            ) : status.lastRunAt ? (
              t('mirrorUpdated', { time: relativeTime(status.lastRunAt), count: status.files })
            ) : null}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onReveal} disabled={!exists}>
              {t('showMirrorFolder')}
            </Button>
            <Button
              size="sm"
              onClick={() => void mirror.runNow()}
              disabled={status.running || !exists}
            >
              <RefreshCw aria-hidden="true" />
              {t('mirrorNow')}
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  );
}

type PrefsState =
  { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; prefs: Prefs };

function usePrefs() {
  const backend = getBackend();
  const [state, setState] = useState<PrefsState>({ status: 'loading' });
  const load = useCallback(() => {
    setState({ status: 'loading' });
    backend.getPrefs().then(
      (prefs) => setState({ status: 'ready', prefs }),
      (error: unknown) => setState({ status: 'error', message: toError(error).message }),
    );
  }, [backend]);
  useEffect(load, [load]);
  const update = async (patch: Parameters<typeof backend.setPrefs>[0]) => {
    const prefs = await backend.setPrefs(patch);
    setState({ status: 'ready', prefs });
    return prefs;
  };
  return { state, load, update };
}

function CaptureAndWindowSections() {
  const ctx = useAppContext();
  const { state, load, update } = usePrefs();
  const [recording, setRecording] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const isApple = ctx.platform.isApple;

  useEffect(() => {
    if (!recording) return undefined;
    const onKey = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        setRecording(false);
        setHint(null);
        return;
      }
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
      const accelerator = acceleratorFromEvent(event, isApple);
      if (!accelerator) {
        setHint(t('shortcutNeedsModifier'));
        return;
      }
      setRecording(false);
      setHint(null);
      void update({ captureShortcut: accelerator, captureEnabled: true });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [recording, isApple, update]);

  if (state.status === 'loading') {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-label={t('loading')}>
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }
  if (state.status === 'error') {
    return (
      <Callout tone="danger" title={t('loadFailed', { message: state.message })}>
        <Button size="sm" className="mt-2" onClick={load}>
          {t('retry')}
        </Button>
      </Callout>
    );
  }
  const { prefs } = state;
  return (
    <>
      <Section title={t('captureSection')} description={t('captureDescription')}>
        <SwitchRow
          label={t('captureToggle')}
          checked={prefs.captureEnabled}
          onChange={(checked) => void update({ captureEnabled: checked })}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-ui text-fg-muted">{t('shortcutLabel')}</span>
          <div className="flex items-center gap-2">
            {recording ? (
              <span className="text-ui text-accent-text" role="status">
                {hint ?? t('pressShortcut')}
              </span>
            ) : (
              <KeyCombo keys={formatAccelerator(prefs.captureShortcut, isApple)} />
            )}
            <Button
              size="sm"
              variant={recording ? 'ghost' : 'secondary'}
              disabled={!prefs.captureEnabled}
              onClick={() => {
                setRecording((value) => !value);
                setHint(null);
              }}
            >
              {recording ? t('cancel') : t('changeShortcut')}
            </Button>
          </div>
        </div>
        {prefs.shortcutError ? (
          <Callout tone="warning">
            {t('shortcutUnavailable', { message: prefs.shortcutError })}
          </Callout>
        ) : null}
      </Section>
      <Separator />
      <Section title={t('windowSection')}>
        <SwitchRow
          label={t('closeToTray')}
          description={t('closeToTrayDescription')}
          checked={prefs.closeToTray}
          onChange={(checked) => void update({ closeToTray: checked })}
        />
      </Section>
    </>
  );
}

function UpdatesSection() {
  const backend = getBackend();
  const { state: prefsState, update } = usePrefs();
  const status = useStore(updateStore);
  const [version, setVersion] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);

  useEffect(() => {
    void backend.appInfo().then(
      (info) => {
        setVersion(info.version);
        setConfigured(info.updatesConfigured);
      },
      () => undefined,
    );
  }, [backend]);

  let line: ReactNode = null;
  if (!configured || status.phase === 'not-configured') {
    line = (
      <span>
        {t('updatesNotConfigured')}{' '}
        <Button variant="link" size="sm" onClick={() => void backend.openExternal(RELEASES_URL)}>
          {t('openReleases')}
        </Button>
      </span>
    );
  } else if (status.phase === 'checking') line = t('checking');
  else if (status.phase === 'up-to-date') line = t('upToDate');
  else if (status.phase === 'available') line = t('updateAvailable', { version: status.version });
  else if (status.phase === 'downloading') line = t('downloading', { percent: status.percent });
  else if (status.phase === 'installing') line = t('installing');
  else if (status.phase === 'error') line = t('updateCheckFailed', { message: status.message });

  return (
    <Section title={t('updatesSection')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-ui font-medium text-fg">{version ? t('version', { version }) : '…'}</p>
          {line ? (
            <p className="text-ui text-fg-muted" role="status">
              {line}
            </p>
          ) : null}
        </div>
        {status.phase === 'available' ? (
          <Button size="sm" variant="primary" onClick={() => void installUpdate(backend)}>
            {t('installAndRestart')}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={!configured || status.phase === 'checking' || status.phase === 'downloading'}
            onClick={() => void checkForUpdates(backend)}
          >
            {t('checkNow')}
          </Button>
        )}
      </div>
      {prefsState.status === 'ready' && configured ? (
        <SwitchRow
          label={t('autoUpdate')}
          checked={prefsState.prefs.checkUpdates}
          onChange={(checked) => void update({ checkUpdates: checked })}
        />
      ) : null}
    </Section>
  );
}

function ServersSection() {
  const ctx = useAppContext();
  const backend = getBackend();
  const [servers, setServers] = useState<ServerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    backend.listServers().then(setServers, (err: unknown) => setError(toError(err).message));
  }, [backend]);
  useEffect(load, [load]);
  const os = ctx.platform.os;
  const keychain =
    os === 'mac'
      ? t('keychain_macos')
      : os === 'windows'
        ? t('keychain_windows')
        : t('keychain_linux');

  const signOut = async (server: string) => {
    const confirmed = await ctx.confirm({
      title: t('signOutConfirmTitle', { server }),
      description: t('signOutConfirmBody'),
      confirmLabel: t('signOut'),
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await backend.deleteSecret(server);
      load();
    } catch (err) {
      ctx.toast({ variant: 'error', title: toError(err).message });
    }
  };

  return (
    <Section title={t('serversSection')} description={t('serversDescription', { keychain })}>
      {error ? (
        <Callout tone="danger" title={t('loadFailed', { message: error })} />
      ) : servers === null ? (
        <Skeleton className="h-10 w-full" />
      ) : servers.length === 0 ? (
        <p className="text-ui text-fg-subtle">{t('noServers')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {servers.map((entry) => (
            <li key={entry.server} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-ui font-medium text-fg">{entry.server}</p>
                <p className="text-xs text-fg-subtle">
                  {t('savedOn', {
                    date: new Date(entry.savedAt).toLocaleDateString(getLocale(), {
                      dateStyle: 'medium',
                    }),
                  })}
                </p>
              </div>
              <Button size="sm" variant="ghost" onClick={() => void signOut(entry.server)}>
                {t('signOut')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
