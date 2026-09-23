import { useAppContext } from '@tessera/core/react';
import { AlertTriangle, Cloud } from 'lucide-react';
import { t } from '../i18n';
import { useStore } from '../lib/store';
import { providerName } from '../workspace/flows';
import { folderStatusStore } from '../workspace/status';

/**
 * A quiet line at the bottom of the sidebar, shown only when the workspace folder needs
 * attention: it's synced by a cloud service, or that service left conflicting copies.
 */
export default function FolderStatus() {
  const ctx = useAppContext();
  const status = useStore(folderStatusStore);
  if (!status || status.id !== ctx.workspace.info.id) return null;
  const conflicts = status.conflicts.length;
  if (!status.cloud && conflicts === 0) return null;
  const label =
    conflicts > 0
      ? t('conflictCount', { count: conflicts })
      : t('syncedBy', { provider: providerName(status.cloud?.provider ?? 'cloud-storage') });
  return (
    <div className="px-2">
      <button
        type="button"
        onClick={() => ctx.navigateTo('/settings/desktop')}
        className={
          conflicts > 0
            ? 'duration-fast flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui text-danger-text transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus'
            : 'duration-fast flex h-7 w-full items-center gap-2 rounded-md px-2 text-ui text-warning-text transition-colors outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus'
        }
      >
        {conflicts > 0 ? (
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
        ) : (
          <Cloud className="size-3.5 shrink-0" aria-hidden="true" />
        )}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <span className="text-xs text-fg-subtle">{t('review')}</span>
      </button>
    </div>
  );
}
