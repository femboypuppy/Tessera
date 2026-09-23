import type { SyncStatus, SyncStatusInfo } from '@tessera/core';

/** Sync status with the details the sync feature's UI shows. */
export interface TesseraSyncStatus extends SyncStatusInfo {
  /** The server gave this device a read-only connection (viewer role). */
  readOnly?: boolean;
  /** The server this workspace syncs with. */
  serverUrl?: string;
  /** Docs the background sync still has to send or fetch. */
  backgroundPending?: number;
}

/** Why the server refused a doc (from the auth reason), for messages and actions. */
export type SyncErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'document-deleted'
  | 'origin-not-allowed'
  | 'invalid-document'
  | 'unknown';

export function errorCode(reason: string): SyncErrorCode {
  switch (reason) {
    case 'unauthenticated':
    case 'forbidden':
    case 'document-deleted':
    case 'origin-not-allowed':
    case 'invalid-document':
      return reason;
    default:
      return 'unknown';
  }
}

/** Two statuses are the same for listeners (they re-render only on real changes). */
export function sameStatus(a: SyncStatusInfo, b: SyncStatusInfo): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export const STATUS_ORDER: Record<SyncStatus, number> = {
  error: 5,
  offline: 4,
  connecting: 3,
  syncing: 2,
  synced: 1,
  local: 0,
};
