import type { PageSectionProps, SidePanelProps } from '@tessera/core';
import { Spinner } from '@tessera/ui';
import { lazy, Suspense } from 'react';

/**
 * `@tessera/sync/ui`: tiny wrappers the sync feature registers. Each one loads its component on
 * first render, so none of the sync UI weighs on the startup bundle.
 */

const SyncStatusIndicator = lazy(() =>
  import('./SyncStatusIndicator').then((module) => ({ default: module.SyncStatusIndicator })),
);
const PresenceAvatars = lazy(() =>
  import('./PresenceAvatars').then((module) => ({ default: module.PresenceAvatars })),
);
const SyncSettingsPanel = lazy(() =>
  import('./settings/SyncSettingsPanel').then((module) => ({ default: module.SyncSettingsPanel })),
);
const HistoryPanel = lazy(() =>
  import('./history/HistoryPanel').then((module) => ({ default: module.HistoryPanel })),
);

/** The top bar's sync status (a same-sized placeholder while it loads: no layout shift). */
export function SyncStatusEntry() {
  return (
    <Suspense fallback={<span className="block h-7 w-7" aria-hidden="true" />}>
      <SyncStatusIndicator />
    </Suspense>
  );
}

/** Presence avatars in the page's top bar. */
export function PresenceEntry(props: PageSectionProps) {
  return (
    <Suspense fallback={null}>
      <PresenceAvatars {...props} />
    </Suspense>
  );
}

/** Settings → Sync & account. */
export function SyncSettingsEntry() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-8">
          <Spinner />
        </div>
      }
    >
      <SyncSettingsPanel />
    </Suspense>
  );
}

/** The version history side panel. */
export function HistoryPanelEntry(props: SidePanelProps) {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center p-6">
          <Spinner />
        </div>
      }
    >
      <HistoryPanel {...props} />
    </Suspense>
  );
}
