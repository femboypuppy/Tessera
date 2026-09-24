import type { DesktopBackend } from '../backend/backend';
import type { WorkspaceStatus } from '../backend/protocol';
import { createStore } from '../lib/store';

/** Folder status of the workspace open in this window: cloud sync, conflicted copies. */
export const folderStatusStore = createStore<WorkspaceStatus | null>(null);

export async function refreshFolderStatus(
  backend: DesktopBackend,
  workspaceId: string,
): Promise<WorkspaceStatus | null> {
  try {
    const status = await backend.workspaceStatus(workspaceId);
    folderStatusStore.set(status);
    return status;
  } catch {
    folderStatusStore.set(null);
    return null;
  }
}
