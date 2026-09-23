import {
  build as b,
  readDocJSON,
  setPageProps,
  writeDocJSON,
  type AppContext,
  type DocJSON,
  type InlineJSON,
  type JsonValue,
} from '@tessera/core';
import { generateWorkspace } from '../bench/generator';
import { applyGeneratedWorkspace } from '../bench/seed';
import { isGraphLinkIndex, isMiniSearchIndex } from '../services/guards';

/** Device setting that turns the hooks on (e2e specs set it before the app loads). */
export const TEST_HOOKS_SETTING = 'search.testHooks';

/** Inline content for {@link SearchTestHooks.writeParagraphs}. */
export type InlineSpec = string | { link: string; label?: string } | { tag: string };

/**
 * Hooks for end-to-end specs and screenshot runs, installed on `window.__tesseraSearch` only when
 * the device setting `search.testHooks` is true. They seed content without depending on the
 * editor's UI (which another feature owns) and wait for the index. Never used by the app itself.
 */
export interface SearchTestHooks {
  /** Generates and writes a workspace; returns its pages. */
  seed(options: { pages: number; seed?: number }): Promise<Array<{ id: string; title: string }>>;
  /** Replaces a page's content with paragraphs of text, links and tags, and sets page props. */
  writeParagraphs(
    pageId: string,
    paragraphs: InlineSpec[][],
    props?: Record<string, JsonValue>,
  ): Promise<void>;
  /** A page's content as DocJSON. */
  readDoc(pageId: string): Promise<DocJSON>;
  /** Resolves once the search and link indexes caught up. */
  whenIndexed(): Promise<void>;
}

declare global {
  interface Window {
    __tesseraSearch?: SearchTestHooks;
  }
}

function inline(spec: InlineSpec): InlineJSON {
  if (typeof spec === 'string') return b.text(spec);
  if ('tag' in spec) return b.tag(spec.tag);
  return b.pageLink(spec.link, spec.label ? { label: spec.label } : {});
}

/** Installs the hooks for a session. Returns a cleanup. */
export function installTestHooks(ctx: AppContext): () => void {
  const hooks: SearchTestHooks = {
    async seed({ pages, seed = 1 }) {
      const workspace = generateWorkspace({ pages, seed });
      await applyGeneratedWorkspace(ctx, workspace);
      return workspace.pages.map((page) => ({ id: page.id, title: page.title }));
    },
    async writeParagraphs(pageId, paragraphs, props) {
      const handle = await ctx.loadPageDoc(pageId);
      try {
        handle.doc.transact(() => {
          writeDocJSON(
            handle.doc,
            b.doc(...paragraphs.map((parts) => b.paragraph(...parts.map(inline)))),
          );
          if (props) setPageProps(handle.doc, props);
        });
      } finally {
        handle.release();
      }
    },
    async readDoc(pageId) {
      const handle = await ctx.loadPageDoc(pageId);
      try {
        return readDocJSON(handle.doc);
      } finally {
        handle.release();
      }
    },
    async whenIndexed() {
      const { searchIndex, linkIndex } = ctx.services;
      if (isMiniSearchIndex(searchIndex)) await searchIndex.whenIdle();
      if (isGraphLinkIndex(linkIndex)) await linkIndex.whenIdle();
    },
  };
  window.__tesseraSearch = hooks;
  return () => {
    if (window.__tesseraSearch === hooks) delete window.__tesseraSearch;
  };
}
