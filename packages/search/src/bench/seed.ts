import { setPageProps, writeDocJSON, type AppContext, type JsonValue } from '@tessera/core';
import type { GeneratedWorkspace } from './generator';

const DAY_MS = 86_400_000;

/**
 * Writes a generated workspace into an open session: pages (with the generator's IDs), then
 * their content and tags. Used by the e2e and screenshot seeding hook, never by the app itself.
 */
export async function applyGeneratedWorkspace(
  ctx: AppContext,
  workspace: GeneratedWorkspace,
  options: { now?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<void> {
  const now = options.now ?? Date.now();
  for (const page of workspace.pages) {
    const input: Parameters<AppContext['workspace']['createPage']>[0] = {
      id: page.id,
      title: page.title,
      parentId: page.parentId,
      createdAt: now - (page.ageDays + 30) * DAY_MS,
      updatedAt: now - page.ageDays * DAY_MS,
    };
    if (page.icon) input.icon = page.icon;
    ctx.workspace.createPage(input);
  }
  let done = 0;
  for (const page of workspace.pages) {
    const handle = await ctx.loadPageDoc(page.id);
    try {
      handle.doc.transact(() => {
        writeDocJSON(handle.doc, page.doc);
        const props: Record<string, JsonValue> = {};
        if (page.tags.length) props.tags = page.tags;
        if (page.aliases.length) props.aliases = page.aliases;
        if (Object.keys(props).length) setPageProps(handle.doc, props);
      });
    } finally {
      handle.release();
    }
    done += 1;
    if (done % 25 === 0) {
      options.onProgress?.(done, workspace.pages.length);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  options.onProgress?.(done, workspace.pages.length);
}
