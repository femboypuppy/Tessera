import { create } from 'zustand';

/** Shell UI state (not document data: that lives in Yjs). */
export interface UiState {
  /** Desktop sidebar visibility. */
  sidebarOpen: boolean;
  /** Phone-width drawer visibility. */
  drawerOpen: boolean;
  sidebarWidth: number;
  /** Open side panel ID, or null. */
  sidePanel: string | null;
  shortcutsOpen: boolean;
  /** The page shown in the main view, or null. */
  currentPageId: string | null;
  setSidebarOpen(open: boolean): void;
  setDrawerOpen(open: boolean): void;
  setSidebarWidth(width: number): void;
  setSidePanel(id: string | null): void;
  setShortcutsOpen(open: boolean): void;
  setCurrentPageId(id: string | null): void;
}

export const SIDEBAR_MIN_WIDTH = 200;
export const SIDEBAR_MAX_WIDTH = 420;
export const SIDEBAR_DEFAULT_WIDTH = 256;

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: true,
  drawerOpen: false,
  sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
  sidePanel: null,
  shortcutsOpen: false,
  currentPageId: null,
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setDrawerOpen: (drawerOpen) => set({ drawerOpen }),
  setSidebarWidth: (width) =>
    set({
      sidebarWidth: Math.round(Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, width))),
    }),
  setSidePanel: (sidePanel) => set({ sidePanel }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  setCurrentPageId: (currentPageId) => set({ currentPageId }),
}));
