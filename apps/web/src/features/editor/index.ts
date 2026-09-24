import { defineFeature, type AppContext, type Command } from '@tessera/core';
import { t } from '@tessera/editor/i18n';
import { Clipboard, Hash, Maximize2, Type } from 'lucide-react';
import { lazy } from 'react';

const loadPageEditor = () => import('@tessera/editor/page-editor');

/** The page body: TipTap, ProseMirror and Yjs bindings load only when needed. */
const PageEditor = lazy(loadPageEditor);

/** The read-only view previews use (version history): the same blocks as the page. */
const DocViewer = lazy(() => import('@tessera/editor/doc-viewer'));

/** The `web` embed renderer (YouTube, Vimeo, Loom, Figma, CodePen, bookmark cards). */
const WebEmbed = lazy(() => import('@tessera/editor/web-embed'));

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

/** Device setting read by the `[[` and `@` autocomplete (recent pages first). */
const RECENT_PAGES_KEY = 'editor.recentPages';

/** Remembers visited pages, most recent first, so link autocomplete can rank them first. */
function trackRecentPages(ctx: AppContext): () => void {
  return ctx.events.on('navigation.changed', ({ pageId }) => {
    if (!pageId) return;
    const stored = ctx.settings.device.get(RECENT_PAGES_KEY);
    const list = Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [];
    ctx.settings.device.set(
      RECENT_PAGES_KEY,
      [pageId, ...list.filter((id) => id !== pageId)].slice(0, 20),
    );
  });
}

/** True when a page (not a database) is open. */
function onPage({ app, pageId }: { app: AppContext; pageId: string | null }): boolean {
  return pageId !== null && app.workspace.getPage(pageId)?.kind === 'page';
}

const commands: Command[] = [
  {
    id: 'editor.wordCount',
    title: t('cmdWordCount'),
    keywords: ['words', 'characters', 'count', 'statistics'],
    group: 'editor',
    icon: Hash,
    when: onPage,
    run: async ({ app, pageId }) => {
      if (!pageId) return;
      const { showWordCount } = await import('@tessera/editor/commands');
      await showWordCount(app, pageId);
    },
  },
  {
    id: 'editor.copyMarkdown',
    title: t('cmdCopyMarkdown'),
    keywords: ['markdown', 'copy', 'export', 'clipboard'],
    group: 'editor',
    icon: Clipboard,
    when: onPage,
    run: async ({ app, pageId }) => {
      if (!pageId) return;
      const { copyPageMarkdown } = await import('@tessera/editor/commands');
      await copyPageMarkdown(app, pageId);
    },
  },
  {
    id: 'editor.toggleFullWidth',
    title: t('cmdToggleFullWidth'),
    keywords: ['wide', 'width', 'layout'],
    group: 'view',
    icon: Maximize2,
    when: onPage,
    run: async ({ app, pageId }) => {
      if (!pageId) return;
      const { togglePageDisplay } = await import('@tessera/editor/commands');
      await togglePageDisplay(app, pageId, 'fullWidth');
    },
  },
  {
    id: 'editor.toggleSmallText',
    title: t('cmdToggleSmallText'),
    keywords: ['font', 'size', 'compact', 'text'],
    group: 'view',
    icon: Type,
    when: onPage,
    run: async ({ app, pageId }) => {
      if (!pageId) return;
      const { togglePageDisplay } = await import('@tessera/editor/commands');
      await togglePageDisplay(app, pageId, 'smallText');
    },
  },
];

/**
 * Editor (Agent 02). Registers the `page` body (`pageBodies.page`), the `web` block renderer and
 * the editor commands; components and logic live in `@tessera/editor`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 */
export const editorFeature = defineFeature({
  id: 'editor',
  pageBodies: { page: PageEditor },
  blockRenderers: [{ kind: 'web', component: WebEmbed, label: t('webEmbed') }],
  docViewers: [{ id: 'editor', component: DocViewer }],
  commands,
  activate: (ctx) => {
    const stopPreload = preloadWhenIdle();
    const stopTracking = trackRecentPages(ctx);
    return () => {
      stopPreload();
      stopTracking();
    };
  },
});
