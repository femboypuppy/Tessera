import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { exitSuggestion, Suggestion } from '@tiptap/suggestion';
import { t } from '../i18n';
import type { EditorController } from '../react/controller';
import {
  filterSlashItems,
  recentSlashItems,
  rememberSlashItem,
  slashSections,
  type SlashItem,
} from './slash-items';
import { suggestionRenderer } from './suggestion-bridge';
import { flattenSections } from './types';

export const slashPluginKey = new PluginKey('tesseraSlashMenu');

/**
 * The `/` menu: every block type (and every block other features register), fuzzy-filtered as
 * you type, recently used first. It closes when nothing matches and you keep typing words.
 */
export function slashCommand(controller: EditorController) {
  return Extension.create({
    name: 'slashCommand',
    // Before the block keymaps, so the open menu gets arrows, Enter and Escape first.
    priority: 200,

    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        Suggestion<SlashItem, SlashItem>({
          editor,
          pluginKey: slashPluginKey,
          char: '/',
          allowSpaces: true,
          startOfLine: false,
          allow: ({ state }) => {
            if (!controller.isEditable()) return false;
            const { $from } = state.selection;
            return !$from.parent.type.spec.code;
          },
          items: ({ query }) => filterSlashItems(editor, controller, query),
          command: ({ editor: current, range, props: item }) => {
            current.chain().focus().deleteRange(range).run();
            rememberSlashItem(controller, item.id);
            void item.run({ editor: current, controller, at: range.from });
          },
          render: suggestionRenderer<SlashItem>(controller, slashPluginKey, (props) => {
            // Typing on past a query that matches nothing closes the menu (it was just text).
            // Items arrive asynchronously: an empty list while loading means nothing yet.
            if (
              !props.loading &&
              props.items.length === 0 &&
              (/\s$/.test(props.query) || props.query.length > 24)
            ) {
              queueMicrotask(() => {
                if (!props.editor.isDestroyed) exitSuggestion(props.editor.view, slashPluginKey);
              });
            }
            const sections = slashSections(props.items, props.query, recentSlashItems(controller));
            return {
              kind: 'slash',
              label: t('slashMenuLabel'),
              query: props.query,
              sections,
              flat: flattenSections(sections),
              emptyLabel: t('noResults'),
            };
          }),
        }),
      ];
    },
  });
}
