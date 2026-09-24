import type { AppContext } from '@tessera/core';
import { useAppContext, useSyncStatus } from '@tessera/core/react';
import { getLocale } from '@tessera/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ServerApi } from '../client/api';
import { authModeFor, serverApi } from '../client/connection';
import { t } from '../i18n';
import { HocuspocusSyncProvider } from '../provider/hocuspocus-provider';
import type { TesseraSyncStatus } from '../provider/status';

/** The workspace's server link, when it syncs with one. */
export interface ServerLink {
  serverUrl: string;
  api: ServerApi;
  provider: HocuspocusSyncProvider | null;
}

/** The server this workspace syncs with, or null for a local-only workspace. */
export function serverLinkOf(ctx: AppContext): ServerLink | null {
  const serverUrl = ctx.workspace.info.serverUrl;
  if (!serverUrl) return null;
  const provider = ctx.services.syncProvider;
  return {
    serverUrl,
    api: serverApi(serverUrl, authModeFor(ctx.platform)),
    provider: provider instanceof HocuspocusSyncProvider ? provider : null,
  };
}

export function useServerLink(): ServerLink | null {
  const ctx = useAppContext();
  return useMemo(() => serverLinkOf(ctx), [ctx]);
}

/** The workspace-wide sync status (the top bar indicator's). */
export function useWorkspaceSyncStatus(): TesseraSyncStatus {
  const ctx = useAppContext();
  return useSyncStatus(ctx.services.syncProvider) as TesseraSyncStatus;
}

export type AsyncState<T> =
  | { status: 'loading'; data: T | null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: T | null; error: Error };

/**
 * Loads data for a view: `loading`, `ready` or `error` (keeping the last data while reloading).
 * `reload` runs the loader again.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
): AsyncState<T> & { reload(): void } {
  const [state, setState] = useState<AsyncState<T>>({ status: 'loading', data: null, error: null });
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let active = true;
    setState((previous) => ({ status: 'loading', data: previous.data, error: null }));
    loadRef.current().then(
      (data) => {
        if (active) setState({ status: 'ready', data, error: null });
      },
      (error: unknown) => {
        if (active)
          setState((previous) => ({
            status: 'error',
            data: previous.data,
            error: error instanceof Error ? error : new Error(String(error)),
          }));
      },
    );
    return () => {
      active = false;
    };
    // The loader's inputs are the caller's `deps`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- deps are passed through by the caller
  }, [...deps, version]);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  return { ...state, reload };
}

/** "5 minutes ago", "yesterday", in the app's language. */
export function formatRelativeTime(time: number, now: number = Date.now()): string {
  const seconds = Math.round((time - now) / 1000);
  if (Math.abs(seconds) < 45) return t('justNow');
  const format = new Intl.RelativeTimeFormat(getLocale(), { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return format.format(days, 'day');
  return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium' }).format(time);
}

/** Re-renders every `intervalMs` (relative times stay current). */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
