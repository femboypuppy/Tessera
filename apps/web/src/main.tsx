import { createAppRuntime, LocalStorageSettingsStore } from '@tessera/core';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { renderFatalError } from './app/FatalError';
import { followTheme } from './app/theme';
import { initI18n, t } from './i18n';
import './styles.css';

async function start(): Promise<void> {
  const container = document.getElementById('root');
  if (!container) throw new Error('Missing #root element');
  const settings = new LocalStorageSettingsStore();
  followTheme(settings);
  // Strings must be registered before feature modules evaluate (they call t() at module scope).
  await initI18n(settings);
  const { features } = await import('./features');
  const runtime = await createAppRuntime({
    features,
    deviceSettings: settings,
    defaultUserName: t('defaultUserName'),
    onError: (error, context) =>
      console.error(`[tessera] ${context.area} ${context.source}:`, error),
  });
  createRoot(container).render(
    <StrictMode>
      <App runtime={runtime} />
    </StrictMode>,
  );
}

start().catch((error: unknown) => renderFatalError(error));
