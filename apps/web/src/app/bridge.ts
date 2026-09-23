import { headingSlug, type ShellBridge } from '@tessera/core';
import { confirm, toast } from '@tessera/ui';
import { useUiStore } from './ui-store';

/** Where a navigation should scroll to, carried in the router location state. */
export interface NavigationTarget {
  heading?: string;
  blockId?: string;
}

const BLOCK_HASH = /^#block-([A-Za-z0-9-]{1,64})$/;

/**
 * The scroll target of a page URL's hash (what `ctx.navigate` writes and "Copy link" copies):
 * `#block-<blockId>` for a block, `#<heading-slug>` for a heading, or null.
 */
export function targetFromHash(hash: string): NavigationTarget | null {
  const blockId = BLOCK_HASH.exec(hash)?.[1];
  if (blockId) return { blockId };
  if (hash.length < 2) return null;
  try {
    return { heading: decodeURIComponent(hash.slice(1)) };
  } catch {
    return null;
  }
}

type NavigateFn = (to: string, options?: { replace?: boolean; state?: unknown }) => void;

/**
 * Creates the {@link ShellBridge} the runtime uses for UI calls. `setNavigate` binds React
 * Router's navigate function once the router is mounted; `setSwitchWorkspace` binds the
 * workspace root's switcher.
 */
export function createShellBridge(): ShellBridge & {
  setNavigate(fn: NavigateFn): void;
  setSwitchWorkspace(fn: (workspaceId: string) => void): void;
} {
  let navigateFn: NavigateFn = (to) => window.history.pushState(null, '', to);
  let switchWorkspaceFn: (workspaceId: string) => void = () => undefined;
  return {
    setNavigate(fn) {
      navigateFn = fn;
    },
    setSwitchWorkspace(fn) {
      switchWorkspaceFn = fn;
    },
    switchWorkspace: (workspaceId) => switchWorkspaceFn(workspaceId),
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
