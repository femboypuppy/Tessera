import { useSyncExternalStore } from 'react';

/**
 * Open state of the databases feature's overlays: the side peek, the CSV import dialog and the
 * database picker for linked views. Tiny on purpose: the always-mounted host reads it at startup,
 * while the overlays themselves load on demand.
 */
export interface OverlayState {
  /** The row shown in the side peek. */
  peek: { rowId: string } | null;
  /** The CSV import dialog, creating the database under `parentId`. */
  csvImport: { parentId: string | null } | null;
  /** The database picker of "Linked view of database": resolves with the chosen view. */
  picker: { resolve: (choice: { databaseId: string; viewId: string } | null) => void } | null;
}

let state: OverlayState = { peek: null, csvImport: null, picker: null };
const listeners = new Set<() => void>();

function set(patch: Partial<OverlayState>): void {
  state = { ...state, ...patch };
  for (const listener of [...listeners]) listener();
}

export const overlays = {
  getState: (): OverlayState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  openPeek: (rowId: string) => set({ peek: { rowId } }),
  closePeek: () => set({ peek: null }),
  openCsvImport: (parentId: string | null = null) => set({ csvImport: { parentId } }),
  closeCsvImport: () => set({ csvImport: null }),
  /** Asks the user to pick a database; resolves null when cancelled. */
  pickDatabase(): Promise<{ databaseId: string; viewId: string } | null> {
    state.picker?.resolve(null);
    return new Promise((resolve) => {
      set({
        picker: {
          resolve: (choice) => {
            set({ picker: null });
            resolve(choice);
          },
        },
      });
    });
  },
  /** Closes everything (a workspace closed). */
  reset(): void {
    state.picker?.resolve(null);
    set({ peek: null, csvImport: null, picker: null });
  },
};

/** The overlay state, re-rendering on changes. */
export function useOverlays(): OverlayState {
  return useSyncExternalStore(overlays.subscribe, overlays.getState, overlays.getState);
}
