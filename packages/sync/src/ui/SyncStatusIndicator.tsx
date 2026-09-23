import { useAppContext } from '@tessera/core/react';
import { Button, Callout, cn, Popover, PopoverContent, PopoverTrigger } from '@tessera/ui';
import {
  CloudAlert,
  CloudCheck,
  CloudOff,
  Eye,
  HardDrive,
  LoaderCircle,
  RefreshCw,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { displayServerUrl } from '../client/server-url';
import { t } from '../i18n';
import { IndexedDbDocStore } from '../stores/doc-store';
import type { StorageErrorInfo } from '../stores/storage-errors';
import { formatRelativeTime, useNow, useServerLink, useWorkspaceSyncStatus } from './hooks';

interface View {
  icon: LucideIcon;
  label: string;
  title: string;
  detail: string;
  tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
  spin?: boolean;
}

const TONES: Record<View['tone'], { icon: string; badge: string }> = {
  neutral: { icon: 'text-fg-muted', badge: 'bg-hover text-fg-muted' },
  success: { icon: 'text-success-text', badge: 'bg-success-subtle text-success-text' },
  warning: { icon: 'text-warning-text', badge: 'bg-warning-subtle text-warning-text' },
  danger: { icon: 'text-danger-text', badge: 'bg-danger-subtle text-danger-text' },
  accent: { icon: 'text-accent-text', badge: 'bg-accent-subtle text-accent-text' },
};

function useStorageProblem(): StorageErrorInfo | null {
  const ctx = useAppContext();
  const store = ctx.services.docStore;
  const [problem, setProblem] = useState<StorageErrorInfo | null>(() =>
    store instanceof IndexedDbDocStore ? store.storageError() : null,
  );
  useEffect(() => {
    if (!(store instanceof IndexedDbDocStore)) return undefined;
    const off = store.onStorageError(setProblem);
    // Recovery isn't an event: check now and then while a problem is shown.
    const timer = setInterval(() => setProblem(store.storageError()), 5000);
    return () => {
      off();
      clearInterval(timer);
    };
  }, [store]);
  return problem;
}

/**
 * The top bar's sync indicator: local only, connecting, offline, syncing, synced or paused
 * (with the reason). Opens a popover with details and the next step.
 */
export function SyncStatusIndicator() {
  const ctx = useAppContext();
  const link = useServerLink();
  const status = useWorkspaceSyncStatus();
  const storage = useStorageProblem();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const server = link ? displayServerUrl(link.serverUrl) : '';

  let view: View;
  switch (status.status) {
    case 'local':
      view = {
        icon: HardDrive,
        label: t('statusLocal'),
        title: t('statusLocal'),
        detail: t('statusLocalDetail'),
        tone: 'neutral',
      };
      break;
    case 'connecting':
      view = {
        icon: LoaderCircle,
        label: t('statusConnecting'),
        title: t('statusConnecting'),
        detail: t('statusConnectingDetail', { server }),
        tone: 'neutral',
        spin: true,
      };
      break;
    case 'offline':
      view = {
        icon: CloudOff,
        label: t('statusOffline'),
        title: t('statusOffline'),
        detail: t('statusOfflineDetail'),
        tone: 'warning',
      };
      break;
    case 'syncing':
      view = {
        icon: RefreshCw,
        label: t('statusSyncing'),
        title: t('statusSyncing'),
        detail: t('statusSyncingDetail'),
        tone: 'accent',
        spin: true,
      };
      break;
    case 'error':
      view = {
        icon: CloudAlert,
        label: t('statusError'),
        title: t('statusError'),
        detail: status.error?.message ?? '',
        tone: 'danger',
      };
      break;
    default:
      view = status.readOnly
        ? {
            icon: Eye,
            label: t('statusReadOnly'),
            title: t('statusReadOnly'),
            detail: t('statusReadOnlyDetail'),
            tone: 'neutral',
          }
        : {
            icon: CloudCheck,
            label: t('statusSynced'),
            title: t('statusSynced'),
            detail: t('statusSyncedDetail', { server }),
            tone: 'success',
          };
  }
  if (storage?.kind === 'quota' && status.status !== 'error') view = { ...view, tone: 'warning' };
  const Icon = view.icon;
  const tone = TONES[view.tone];
  const pending = status.pendingUpdates ?? 0;
  const background = status.backgroundPending ?? 0;
  const goToSettings = () => {
    setOpen(false);
    ctx.navigateTo('/settings/sync');
  };
  const signedOut = status.status === 'error' && status.error?.code === 'unauthenticated';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t('syncStatusLabel', { status: view.label })}
          data-sync-status={status.status}
          className="duration-fast flex h-7 items-center gap-1.5 rounded-md px-1.5 text-ui text-fg-muted transition-colors outline-none hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-focus data-[state=open]:bg-hover"
        >
          <Icon
            aria-hidden="true"
            className={cn('size-4 shrink-0', tone.icon, view.spin && 'motion-safe:animate-spin')}
          />
          <span className="hidden sm:inline">{view.label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex gap-3 p-3">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg [&_svg]:size-4',
              tone.badge,
            )}
          >
            <Icon aria-hidden="true" className={cn(view.spin && 'motion-safe:animate-spin')} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-fg">{view.title}</p>
            <p className="mt-0.5 text-ui leading-snug text-fg-muted">{view.detail}</p>
          </div>
        </div>
        {link ? (
          <dl className="flex flex-col gap-1 border-t border-border px-3 py-2.5 text-ui">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('serverAddress')}</dt>
              <dd className="truncate font-medium text-fg">{server}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-muted">{t('statusSynced')}</dt>
              <dd className="text-fg">
                {status.lastSyncedAt
                  ? t('lastSynced', { time: formatRelativeTime(status.lastSyncedAt, now) })
                  : t('neverSynced')}
              </dd>
            </div>
            {pending > 0 && status.status !== 'synced' ? (
              <p className="text-fg-muted">{t('pendingChanges', { count: pending })}</p>
            ) : null}
            {background > 0 ? (
              <p className="text-fg-muted">{t('backgroundPending', { count: background })}</p>
            ) : null}
          </dl>
        ) : null}
        {storage?.kind === 'quota' ? (
          <div className="border-t border-border p-2">
            <Callout tone="warning">{t('storageWarning')}</Callout>
          </div>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border p-2">
          {!link ? (
            <Button size="sm" variant="primary" onClick={goToSettings}>
              {t('connectToServer')}
            </Button>
          ) : (
            <>
              {(status.status === 'offline' || status.status === 'error') && !signedOut ? (
                <Button
                  size="sm"
                  onClick={() => {
                    link.provider?.retry();
                  }}
                >
                  <RefreshCw aria-hidden="true" />
                  {t('retryNow')}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant={signedOut ? 'primary' : 'secondary'}
                onClick={goToSettings}
              >
                {signedOut ? t('signInAgain') : t('syncSettings')}
              </Button>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
