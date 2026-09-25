import { Spinner } from '@tessera/ui';
import { t } from '../i18n';

/** A centered spinner for whole-screen loading states, with what is happening when it says. */
export function FullScreenLoading({ label }: { label?: string }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-bg" aria-busy="true">
      <div className="flex flex-col items-center gap-3">
        <Spinner size="lg" label={label ?? t('loading')} />
        {label ? (
          <p className="text-sm text-fg-muted" aria-hidden="true">
            {label}
          </p>
        ) : null}
      </div>
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
