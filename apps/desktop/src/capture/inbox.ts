import {
  isDocEmpty,
  updateDocJSON,
  type AppContext,
  type BlockJSON,
  type PageMeta,
  type TaskItemJSON,
} from '@tessera/core';
import { t } from '../i18n';

/** Workspace setting (synced): the page quick capture appends to. */
export const INBOX_SETTING = 'desktop.inboxPageId';

const TASK = /^\s*(?:[-*]\s+)?\[( |x|X)\]\s+(.*)$/;

/**
 * Turns captured text into blocks: one paragraph per line, and `[ ] buy milk` or `- [x] done`
 * lines as tasks (consecutive tasks share one list). Blank lines are dropped.
 */
export function captureBlocks(text: string): BlockJSON[] {
  const blocks: BlockJSON[] = [];
  let tasks: TaskItemJSON[] | null = null;
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      tasks = null;
      continue;
    }
    const task = TASK.exec(line);
    if (task) {
      const item: TaskItemJSON = {
        type: 'taskItem',
        attrs: { checked: task[1] !== ' ' },
        content: [{ type: 'paragraph', content: task[2] ? [{ type: 'text', text: task[2] }] : [] }],
      };
      if (tasks) tasks.push(item);
      else {
        tasks = [item];
        blocks.push({ type: 'taskList', content: tasks });
      }
      continue;
    }
    tasks = null;
    blocks.push({ type: 'paragraph', content: [{ type: 'text', text: line }] });
  }
  return blocks;
}

/** The Inbox page: the one recorded in the workspace settings, or a new one at the top level. */
export function findOrCreateInbox(ctx: AppContext): PageMeta {
  const snapshot = ctx.workspace.pages.getSnapshot();
  const saved = ctx.settings.workspace.get(INBOX_SETTING);
  if (typeof saved === 'string') {
    const page = snapshot.get(saved);
    if (page && !snapshot.isTrashed(saved)) return page;
  }
  const page = ctx.workspace.createPage({ title: t('inboxTitle'), icon: '📥', parentId: null });
  ctx.settings.workspace.set(INBOX_SETTING, page.id);
  return page;
}

/** Appends captured text to the end of the Inbox page. Returns the page. */
export async function appendToInbox(ctx: AppContext, text: string): Promise<PageMeta> {
  const blocks = captureBlocks(text);
  const page = findOrCreateInbox(ctx);
  if (blocks.length === 0) return page;
  const handle = await ctx.loadPageDoc(page.id);
  try {
    updateDocJSON(handle.doc, (doc) => ({
      ...doc,
      content: [...(isDocEmpty(doc) ? [] : doc.content), ...blocks],
    }));
  } finally {
    handle.release();
  }
  return page;
}
