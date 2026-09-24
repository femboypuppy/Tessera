import type { AppContext } from '@tessera/core';
import type { DesktopBackend } from './backend/backend';
import { TauriBackend } from './backend/tauri-backend';

/**
 * Per-page desktop state: the backend, what must be flushed before the app exits, and the
 * workspace session currently open in this window (menus and deep links act on it).
 */

let backend: DesktopBackend | null = null;

/** The backend of this page (Tauri IPC), created on first use. */
export function getBackend(): DesktopBackend {
  backend ??= new TauriBackend();
  return backend;
}

/** Replaces the backend (tests). Pass null to go back to the default. */
export function setBackend(next: DesktopBackend | null): void {
  backend = next;
}

const flushables = new Set<() => Promise<void>>();

/** Registers something to flush before the app exits (stores). Returns an unregister function. */
export function registerFlushable(flush: () => Promise<void>): () => void {
  flushables.add(flush);
  return () => flushables.delete(flush);
}

/** Flushes every registered store; failures are logged, never thrown. */
export async function flushAll(): Promise<void> {
  const results = await Promise.allSettled([...flushables].map((flush) => flush()));
  for (const result of results)
    if (result.status === 'rejected') console.error('[desktop] flush failed', result.reason);
}

let currentContext: AppContext | null = null;
const contextListeners = new Set<(ctx: AppContext | null) => void>();

/** Set by `activateDesktop` while a workspace session is open in this window. */
export function setCurrentContext(ctx: AppContext | null): void {
  currentContext = ctx;
  for (const listener of [...contextListeners]) listener(ctx);
}

export function getCurrentContext(): AppContext | null {
  return currentContext;
}

export function onContextChange(listener: (ctx: AppContext | null) => void): () => void {
  contextListeners.add(listener);
  return () => contextListeners.delete(listener);
}

let appListeners: (() => void) | null = null;
const resetHooks = new Set<() => void>();

/** Registers module state to clear in {@link resetDesktopRuntime}. */
export function onReset(hook: () => void): void {
  resetHooks.add(hook);
}

/** Forgets every per-page singleton (tests run many "pages" in one process). */
export function resetDesktopRuntime(): void {
  appListeners?.();
  appListeners = null;
  backend = null;
  currentContext = null;
  flushables.clear();
  contextListeners.clear();
  for (const hook of resetHooks) hook();
}

/**
 * Listeners that live as long as the page (installed once, when the workspace registry is
 * created at startup): answering the exit flush, even before any workspace is open.
 */
export function installAppListeners(target: DesktopBackend = getBackend()): () => void {
  if (appListeners) return appListeners;
  const off = target.onFlushRequest(() => {
    void flushAll().finally(() => {
      target.flushDone().catch((error: unknown) => console.error('[desktop] flush ack', error));
    });
  });
  appListeners = () => {
    off();
    appListeners = null;
  };
  return appListeners;
}
