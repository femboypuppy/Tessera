import { Spinner } from '@tessera/ui';
import { t } from '../i18n';

/** A centered spinner for whole-screen loading states. */
export function FullScreenLoading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" aria-busy="true">
      <Spinner size="lg" label={t('loading')} />
    </div>
  );
}

/** A spinner for a view loading inside the main area (lazy views and feature routes). */
export function ViewLoading() {
  return (
    <div className="flex justify-center py-24" aria-busy="true">
      <Spinner label={t('loading')} />
    </div>
  );
}
