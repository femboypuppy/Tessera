import { headingSlug, type ShellBridge } from '@tessera/core';
import { confirm, toast } from '@tessera/ui';
import { useUiStore } from './ui-store';

/** Where a navigation should scroll to, carried in the router location state. */
export interface NavigationTarget {
  heading?: string;
  blockId?: string;
}

type NavigateFn = (to: string, options?: { replace?: boolean; state?: unknown }) => void;

/**
 * Creates the {@link ShellBridge} the runtime uses for UI calls. `setNavigate` binds React
 * Router's navigate function once the router is mounted.
 */
export function createShellBridge(): ShellBridge & { setNavigate(fn: NavigateFn): void } {
  let navigateFn: NavigateFn = (to) => window.history.pushState(null, '', to);
  return {
    setNavigate(fn) {
      navigateFn = fn;
    },
    navigate(pageId, options = {}) {
      const target: NavigationTarget = {};
      if (options.heading) target.heading = options.heading;
      if (options.blockId) target.blockId = options.blockId;
      const hash = options.blockId
        ? `#block-${options.blockId}`
        : options.heading
          ? `#${headingSlug(options.heading)}`
          : '';
      navigateFn(`/p/${encodeURIComponent(pageId)}${hash}`, {
        replace: options.replace,
        state: { target },
      });
      useUiStore.getState().setDrawerOpen(false);
    },
    navigateTo(path, options = {}) {
      navigateFn(path, { replace: options.replace });
      useUiStore.getState().setDrawerOpen(false);
    },
    getCurrentPageId: () => useUiStore.getState().currentPageId,
    openSidePanel: (id) => useUiStore.getState().setSidePanel(id),
    closeSidePanel: () => useUiStore.getState().setSidePanel(null),
    toast: (options) => toast(options),
    confirm: (options) => confirm(options),
  };
}
