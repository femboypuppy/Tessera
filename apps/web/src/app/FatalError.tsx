import { toError } from '@tessera/core';
import { Button, describeError, ErrorBoundary, tUi } from '@tessera/ui';
import { AlertOctagon, Copy, RotateCw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../i18n';

/** The whole-screen error shown when the app cannot start or the shell itself crashes. */
export function FatalErrorScreen({ error }: { error: Error }) {
  const [copied, setCopied] = useState(false);
  return (
    <main className="grid min-h-dvh place-items-center bg-bg p-6 text-fg">
      <div
        role="alert"
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-dialog"
      >
        <AlertOctagon className="size-6 text-danger-text" aria-hidden="true" />
        <h1 className="mt-3 text-lg font-semibold">{t('fatalTitle')}</h1>
        <p className="mt-1 text-ui text-fg-muted">{t('fatalHint')}</p>
        <pre className="mt-4 max-h-40 overflow-auto rounded-md bg-bg-subtle p-3 font-mono text-xs text-fg-muted">
          {error.message}
        </pre>
        <div className="mt-5 flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            <RotateCw aria-hidden="true" />
            {t('reload')}
          </Button>
          <Button
            onClick={() => {
              void navigator.clipboard
                ?.writeText(describeError(error, { URL: window.location.href }))
                .then(() => setCopied(true));
            }}
          >
            <Copy aria-hidden="true" />
            {copied ? tUi('copied') : tUi('copyDetails')}
          </Button>
        </div>
      </div>
    </main>
  );
}

/** Catches errors thrown by the shell itself (features have their own boundaries). */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary fallback={(error) => <FatalErrorScreen error={error} />}>
      {children}
    </ErrorBoundary>
  );
}

/** Renders the fatal error screen outside React's tree (startup failures). */
export function renderFatalError(error: unknown): void {
  console.error('[tessera] startup failed', error);
  const container = document.getElementById('root');
  if (container) createRoot(container).render(<FatalErrorScreen error={toError(error)} />);
}
