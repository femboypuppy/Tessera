import type { SettingsStore } from '@tessera/core';

/** Device setting holding recently opened pages, per workspace (newest first). */
export function recentKey(workspaceId: string): string {
  return `search.recent.${workspaceId}`;
}

const MAX_RECENT = 20;

/** Recently opened page IDs, newest first. */
export function readRecent(settings: SettingsStore, workspaceId: string): string[] {
  const value = settings.get(recentKey(workspaceId));
  return Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').slice(0, MAX_RECENT)
    : [];
}

/** Moves a page to the front of the recent list. */
export function pushRecent(settings: SettingsStore, workspaceId: string, pageId: string): void {
  const current = readRecent(settings, workspaceId);
  if (current[0] === pageId) return;
  settings.set(
    recentKey(workspaceId),
    [pageId, ...current.filter((id) => id !== pageId)].slice(0, MAX_RECENT),
  );
}
