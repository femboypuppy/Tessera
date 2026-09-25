import { useSyncExternalStore } from 'react';

/**
 * Open state of the command palette. Kept tiny and dependency-free: the palette host (an overlay)
 * is part of the startup bundle, the palette itself loads on demand.
 */
export interface PaletteState {
  open: boolean;
  /** Text to start with (for example `>` for commands). */
  initialQuery: string;
  /** Increments on every open, so the palette resets its state. */
  session: number;
}

let state: PaletteState = { open: false, initialQuery: '', session: 0 };
const listeners = new Set<() => void>();

function set(next: PaletteState): void {
  state = next;
  for (const listener of [...listeners]) listener();
}

export const paletteStore = {
  getState: (): PaletteState => state,
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  open(initialQuery = ''): void {
    set({ open: true, initialQuery, session: state.session + 1 });
  },
  close(): void {
    if (state.open) set({ ...state, open: false });
  },
  /**
   * Edits the text the palette starts with, while it is open but not on screen yet (its code is
   * still loading), so keys typed right after Mod+K land in the palette.
   */
  editInitialQuery(edit: (query: string) => string): void {
    if (state.open) set({ ...state, initialQuery: edit(state.initialQuery) });
  },
  /** Mod+K toggles: a second press closes the palette. */
  toggle(initialQuery = ''): void {
    if (state.open) paletteStore.close();
    else paletteStore.open(initialQuery);
  },
};

/** The palette state, re-rendering on changes. */
export function usePaletteState(): PaletteState {
  return useSyncExternalStore(paletteStore.subscribe, paletteStore.getState, paletteStore.getState);
}
