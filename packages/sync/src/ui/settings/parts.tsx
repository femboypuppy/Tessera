import { Button, Callout, cn, Skeleton } from '@tessera/ui';
import type { ReactNode } from 'react';
import { ServerApiError } from '../../client/api';
import { t } from '../../i18n';

/** A plain-language message for a failed server call. */
export function errorMessage(error: unknown): string {
  if (error instanceof ServerApiError) {
    if (error.isNetworkError) return t('serverUnreachable');
    return error.message;
  }
  return error instanceof Error ? error.message : String(error);
}

export function Section({
  title,
  description,
  actions,
  children,
  labelledBy,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
  labelledBy: string;
}) {
  return (
    <section aria-labelledby={labelledBy} className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={labelledBy} className="text-sm font-semibold text-fg">
            {title}
          </h3>
          {description ? <p className="mt-0.5 text-ui text-fg-muted">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('rounded-xl border border-border bg-surface p-4 shadow-subtle', className)}>
      {children}
    </div>
  );
}

/** An inline error with a retry button. */
export function LoadError({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <Callout tone="danger" title={t('loadFailed', { message: errorMessage(error) })}>
      {onRetry ? (
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRetry}>
          {t('tryAgain')}
        </Button>
      ) : null}
    </Callout>
  );
}

export function LoadingRows({ rows = 2 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  );
}
