import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { Suggestion } from '@tiptap/suggestion';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import {
  pageSuggestions,
  readRecentPages,
  RECENT_PAGES_KEY,
  withRecentPage,
  type PageMenuItem,
} from './page-items';
import { suggestionRenderer } from './suggestion-bridge';

export const wikilinkPluginKey = new PluginKey('tesseraWikilinkMenu');
export const mentionPluginKey = new PluginKey('tesseraMentionMenu');

/** Recently visited or linked pages (device setting). */
export function recentPages(controller: EditorController): string[] {
  return readRecentPages(controller.ctx.settings.device.get(RECENT_PAGES_KEY));
}

/** Inserts a link to the chosen page (creating it first for "Create page") in place of `range`. */
export function insertPageLinkItem(
  editor: Editor,
  controller: EditorController,
  range: Range,
  item: PageMenuItem,
): void {
  let pageId: string;
  if (item.kind === 'create') {
    const page = controller.ctx.workspace.createPage({
      title: item.newTitle,
      parentId: controller.pageId,
    });
    pageId = page.id;
  } else {
    pageId = item.pageId;
  }
  editor
    .chain()
    .focus()
    .insertContentAt(range, [
      { type: 'pageLink', attrs: { pageId } },
      { type: 'text', text: ' ' },
    ])
    .run();
  controller.ctx.settings.device.set(
    RECENT_PAGES_KEY,
    withRecentPage(recentPages(controller), pageId),
  );
}

function pageMenu(
  controller: EditorController,
  editor: Editor,
  options: { char: string; pluginKey: PluginKey; allowSpaces: boolean },
) {
  return Suggestion<PageMenuItem, PageMenuItem>({
    editor,
    pluginKey: options.pluginKey,
    char: options.char,
    allowSpaces: options.allowSpaces,
    startOfLine: false,
    allow: ({ state }) => {
      if (!controller.isEditable()) return false;
      return !state.selection.$from.parent.type.spec.code;
    },
    items: ({ query }) =>
      query.includes(']]') || query.includes('\n')
        ? []
        : pageSuggestions(
            controller.ctx.workspace.pages.getSnapshot(),
            query,
            recentPages(controller),
            controller.pageId,
          ),
    command: ({ editor: current, range, props: item }) =>
      insertPageLinkItem(current, controller, range, item),
    render: suggestionRenderer<PageMenuItem>(controller, options.pluginKey, (props) => ({
      kind: 'page',
      label: t('linkMenuLabel'),
      query: props.query,
      sections: [{ id: 'pages', label: '', items: props.items }],
      flat: props.items,
      emptyLabel: t('noPages'),
    })),
  });
}

/**
 * Page autocomplete: `[[` (spaces allowed, like Obsidian) and `@` (one word, like a mention)
 * open a fuzzy list of pages, recent ones first, plus "Create page 'X'", which creates the page
 * under the current one and links to it.
 */
export function pageLinkCommand(controller: EditorController) {
  return Extension.create({
    name: 'pageLinkCommand',
    priority: 200,
    addProseMirrorPlugins() {
      return [
        pageMenu(controller, this.editor, {
          char: '[[',
          pluginKey: wikilinkPluginKey,
          allowSpaces: true,
        }),
        pageMenu(controller, this.editor, {
          char: '@',
          pluginKey: mentionPluginKey,
          allowSpaces: false,
        }),
      ];
    },
  });
}
