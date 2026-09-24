import type { ImportFile, ImportProgress, ImportReport } from '@tessera/core';
import { useSyncExternalStore } from 'react';

/** An import that runs, or ran, in the open workspace. It outlives the dialog. */
export type ImportJob =
  | {
      status: 'running';
      importerId: string;
      progress: ImportProgress | null;
      cancelled: boolean;
      cancel: () => void;
    }
  | { status: 'done'; importerId: string; report: ImportReport }
  | { status: 'failed'; importerId: string; message: string };

/** State of the import and export dialogs (the overlay renders from it). */
export interface ImportExportState {
  importOpen: boolean;
  /** The source picked when the dialog opened (for example from "Import from Notion"). */
  importerId: string | null;
  /** Increments each time the import dialog opens, so it starts from its first step. */
  importSession: number;
  exportOpen: boolean;
  /** The page the export dialog was opened for, if any. */
  exportPageId: string | null;
  exportSession: number;
  job: ImportJob | null;
}

const INITIAL: ImportExportState = {
  importOpen: false,
  importerId: null,
  importSession: 0,
  exportOpen: false,
  exportPageId: null,
  exportSession: 0,
  job: null,
};

let state: ImportExportState = INITIAL;
const listeners = new Set<() => void>();

export function getImportExportState(): ImportExportState {
  return state;
}

export function setImportExportState(patch: Partial<ImportExportState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads a slice of the dialog state; the component re-renders when it changes. */
export function useImportExportState<T>(select: (current: ImportExportState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => select(state),
    () => select(INITIAL),
  );
}

/** Opens the import dialog, optionally with a source picked. */
export function openImportDialog(importerId: string | null = null): void {
  setImportExportState({
    importOpen: true,
    importerId,
    importSession: state.importSession + 1,
    exportOpen: false,
  });
}

export function closeImportDialog(): void {
  setImportExportState({ importOpen: false });
}

/** Opens the export dialog for a page (or the workspace when `pageId` is null). */
export function openExportDialog(pageId: string | null = null): void {
  setImportExportState({
    exportOpen: true,
    exportPageId: pageId,
    exportSession: state.exportSession + 1,
    importOpen: false,
  });
}

export function closeExportDialog(): void {
  setImportExportState({ exportOpen: false });
}

/** Forgets a finished import, so the dialog starts over. */
export function clearImportJob(): void {
  if (state.job?.status !== 'running') setImportExportState({ job: null });
}

/** Cancels a running import and closes the dialogs (the workspace session is closing). */
export function resetImportExport(): void {
  if (state.job?.status === 'running') state.job.cancel();
  setImportExportState({ importOpen: false, exportOpen: false, job: null });
}

/** A backup waiting to be restored into the workspace created for it. */
let pendingRestore: { workspaceId: string; file: ImportFile } | null = null;

export function setPendingRestore(workspaceId: string, file: ImportFile): void {
  pendingRestore = { workspaceId, file };
}

/** Returns (and forgets) the backup to restore into this workspace, if any. */
export function takePendingRestore(workspaceId: string): ImportFile | null {
  if (pendingRestore?.workspaceId !== workspaceId) return null;
  const { file } = pendingRestore;
  pendingRestore = null;
  return file;
}
