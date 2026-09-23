/**
 * @tessera/desktop — the Tauri 2 desktop app (Agent 07).
 *
 * The TypeScript side exports desktop services (TauriDocStore, TauriAssetStore,
 * TauriWorkspaceRegistry, priority 100) that `apps/web/src/features/desktop` registers when running
 * inside Tauri. See README.md and HANDOFF/architect.md.
 */
export const DESKTOP_PACKAGE = '@tessera/desktop';

/** True when running inside a Tauri webview. */
export function isTauri(): boolean {
  return typeof globalThis === 'object' && '__TAURI_INTERNALS__' in globalThis;
}
