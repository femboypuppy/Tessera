import {
  build,
  extractPlainText,
  isDocEmpty,
  readDocJSON,
  updateDocJSON,
  writeDocJSON,
  type AppContext,
  type DocJSON,
  type SyncStatusInfo,
} from '@tessera/core';

/** Device setting that turns the hooks on (end-to-end tests set it; nothing else does). */
export const DEBUG_SETTING = 'sync.debug';

/**
 * Page content access for end-to-end tests while the real editor lives on another branch:
 * `window.__tesseraSync.appendParagraph(pageId, text)` and `readText(pageId)` go through the same
 * doc handles as the editor does.
 */
export interface SyncDebugHooks {
  readText(pageId: string): Promise<string>;
  appendParagraph(pageId: string, text: string): Promise<void>;
  /** Replaces a page's content (validated like any write). */
  writeDocJSON(pageId: string, json: DocJSON): Promise<void>;
  status(): SyncStatusInfo;
}

declare global {
  interface Window {
    __tesseraSync?: SyncDebugHooks;
  }
}

export function installDebugHooks(ctx: AppContext): () => void {
  if (typeof window === 'undefined' || ctx.settings.device.get(DEBUG_SETTING) !== true)
    return () => undefined;
  const hooks: SyncDebugHooks = {
    async readText(pageId) {
      const handle = await ctx.loadPageDoc(pageId);
      try {
        return extractPlainText(readDocJSON(handle.doc));
      } finally {
        handle.release();
      }
    },
    async appendParagraph(pageId, text) {
      const handle = await ctx.loadPageDoc(pageId);
      try {
        updateDocJSON(handle.doc, (doc) => ({
          ...doc,
          content: isDocEmpty(doc) ? [build.p(text)] : [...doc.content, build.p(text)],
        }));
      } finally {
        handle.release();
      }
    },
    async writeDocJSON(pageId, json) {
      const handle = await ctx.loadPageDoc(pageId);
      try {
        writeDocJSON(handle.doc, json);
      } finally {
        handle.release();
      }
    },
    status: () => ctx.services.syncProvider.getStatus(),
  };
  window.__tesseraSync = hooks;
  return () => {
    if (window.__tesseraSync === hooks) delete window.__tesseraSync;
  };
}
