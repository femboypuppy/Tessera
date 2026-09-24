import { useAppContext } from '@tessera/core/react';
import { IconButton, SidebarItem } from '@tessera/ui';
import { Database, FileUp } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { tCore } from './i18n/core';
import { overlays, useOverlays } from './overlay-store';

/*
 * The only components of the databases feature in the startup bundle: the always-mounted overlay
 * host and the sidebar buttons. Everything else loads when first used.
 */

const DatabaseOverlays = lazy(() => import('./entries/overlays'));

/** Mounts the side peek, the CSV import dialog and the database picker while one is open. */
export function DatabaseOverlayHost() {
  const state = useOverlays();
  if (!state.peek && !state.csvImport && !state.picker) return null;
  return (
    <Suspense fallback={null}>
      <DatabaseOverlays state={state} />
    </Suspense>
  );
}

/** "New database" under "New page" in the sidebar, with "Import CSV as database" beside it. */
export function NewDatabaseSidebarItem() {
  const ctx = useAppContext();
  return (
    <div className="flex items-center gap-0.5">
      <SidebarItem
        className="flex-1"
        icon={<Database />}
        label={tCore('newDatabase')}
        onClick={() => {
          void import('./entries/actions').then(({ newDatabaseAndOpen }) =>
            newDatabaseAndOpen(ctx),
          );
        }}
      />
      <IconButton
        size="sm"
        label={tCore('importCsv')}
        icon={<FileUp />}
        onClick={() => overlays.openCsvImport(null)}
      />
    </div>
  );
}
