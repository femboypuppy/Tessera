import { defineFeature } from '@tessera/core';
import { lazy } from 'react';

const loadPageEditor = () => import('@tessera/editor/page-editor');

/** The page body: TipTap, ProseMirror and Yjs bindings load only when needed. */
const PageEditor = lazy(loadPageEditor);

/** Starts loading the editor while the app is idle, so the first page opens instantly. */
function preloadWhenIdle(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const preload = () => void loadPageEditor().catch(() => undefined);
  if ('requestIdleCallback' in window) {
    const handle = window.requestIdleCallback(preload, { timeout: 3000 });
    return () => window.cancelIdleCallback(handle);
  }
  const timer = globalThis.setTimeout(preload, 1500);
  return () => globalThis.clearTimeout(timer);
}

/**
 * Editor (Agent 02). Registers the `page` body (`pageBodies.page`), the `web` block renderer and
 * the editor commands; components and logic live in `@tessera/editor`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 */
export const editorFeature = defineFeature({
  id: 'editor',
  pageBodies: { page: PageEditor },
  activate: () => preloadWhenIdle(),
});
