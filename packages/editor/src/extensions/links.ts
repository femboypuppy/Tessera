import { isHttpUrl, isSafeHref } from '@tessera/core';
import { Extension, InputRule, type Editor } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Bookmark, Link2, MonitorPlay } from 'lucide-react';
import { insertWebEmbed } from '../actions/media';
import { resolveEmbed } from '../embeds/providers';
import { t } from '../i18n';
import { foldText } from '../menus/fuzzy';
import { caretRect } from '../menus/slash-items';
import { moveActive } from '../menus/suggestion-bridge';
import type { MenuItem } from '../menus/types';
import { openPageLink, searchTag } from '../node-views/inline';
import type { EditorController } from '../react/controller';

interface PastedUrl {
  from: number;
  to: number;
  url: string;
}

export const urlPasteKey = new PluginKey<PastedUrl | null>('tesseraUrlPaste');

type PasteChoice = MenuItem & { choice: 'link' | 'embed' | 'bookmark' };

/** Opens a link in a new tab (safe links only). */
export function openHref(href: string | null | undefined): void {
  if (!isSafeHref(href)) return;
  window.open(href, '_blank', 'noopener,noreferrer');
}

/** Replaces a pasted link with a web embed or bookmark (an emptied paragraph is replaced). */
function convertPastedUrl(editor: Editor, pasted: PastedUrl, display: 'embed' | 'bookmark'): void {
  const { doc } = editor.state;
  if (pasted.to > doc.content.size || doc.textBetween(pasted.from, pasted.to) !== pasted.url)
    return;
  editor.chain().deleteRange({ from: pasted.from, to: pasted.to }).run();
  insertWebEmbed(editor, pasted.url, display, Math.min(pasted.from, editor.state.doc.content.size));
  editor.view.focus();
}

/**
 * Links: pasting a URL over selected text links it; pasting a bare URL inserts a link and offers
 * to keep it, embed it (allowlisted sites) or turn it into a bookmark card, in a small menu that
 * never takes focus (keep typing to dismiss it). Mod+click opens links (a plain click does on
 * read-only pages); Enter opens a selected page link or searches a selected tag; typing
 * `[[Exact title]]` in full links to that page.
 */
export function links(controller: EditorController) {
  return Extension.create({
    name: 'tesseraLinks',
    priority: 150,

    addInputRules() {
      return [
        new InputRule({
          find: /\[\[([^[\]\n]{1,200})\]\]$/,
          handler: ({ state, range, match }) => {
            const title = foldText((match[1] ?? '').trim());
            if (!title) return null;
            const snapshot = controller.ctx.workspace.pages.getSnapshot();
            const page = snapshot
              .all()
              .find(
                (candidate) =>
                  foldText(candidate.title) === title && !snapshot.isTrashed(candidate.id),
              );
            const type = state.schema.nodes.pageLink;
            if (!page || !type) return null;
            state.tr.replaceWith(range.from, range.to, type.create({ pageId: page.id }));
            return undefined;
          },
        }),
      ];
    },

    addKeyboardShortcuts() {
      return {
        Enter: ({ editor }) => {
          const { selection } = editor.state;
          if (!(selection instanceof NodeSelection)) return false;
          if (selection.node.type.name === 'pageLink') {
            openPageLink(controller, selection.node);
            return true;
          }
          if (selection.node.type.name === 'tag') {
            void searchTag(controller, String(selection.node.attrs.name ?? ''));
            return true;
          }
          return false;
        },
      };
    },

    addProseMirrorPlugins() {
      const editor = this.editor;
      const close = () => {
        if (controller.menu.get()?.kind === 'paste') controller.menu.set(null);
      };
      const openMenu = (pasted: PastedUrl) => {
        const choices: PasteChoice[] = [
          { id: 'link', choice: 'link', title: t('pasteAsLink'), icon: Link2 },
          ...(resolveEmbed(pasted.url)
            ? [
                {
                  id: 'embed',
                  choice: 'embed' as const,
                  title: t('pasteAsEmbed'),
                  icon: MonitorPlay,
                },
              ]
            : []),
          { id: 'bookmark', choice: 'bookmark', title: t('pasteAsBookmark'), icon: Bookmark },
        ];
        controller.menu.set({
          kind: 'paste',
          label: t('pasteUrlMenu'),
          query: pasted.url,
          sections: [{ id: 'paste', label: t('pasteUrlMenu'), items: choices }],
          flat: choices,
          active: 0,
          emptyLabel: '',
          getRect: () => caretRect(editor, pasted.to),
          select: (item) => {
            const current = urlPasteKey.getState(editor.state);
            editor.view.dispatch(editor.state.tr.setMeta(urlPasteKey, null));
            close();
            const choice = (item as PasteChoice).choice;
            if (current && choice !== 'link') convertPastedUrl(editor, current, choice);
            else editor.view.focus();
          },
        });
      };

      return [
        new Plugin<PastedUrl | null>({
          key: urlPasteKey,
          state: {
            init: () => null,
            apply(tr, value) {
              const meta = tr.getMeta(urlPasteKey) as PastedUrl | null | undefined;
              if (meta !== undefined) return meta;
              // Any other edit or caret move dismisses the menu (the link stays); transactions
              // appended by plugins (block IDs) belong to the paste itself.
              if (value && !tr.getMeta('appendedTransaction') && (tr.docChanged || tr.selectionSet))
                return null;
              return value;
            },
          },
          view: () => ({
            update(view, previous) {
              const current = urlPasteKey.getState(view.state);
              if (current === urlPasteKey.getState(previous)) return;
              if (current) openMenu(current);
              else close();
            },
            destroy: close,
          }),
          props: {
            handlePaste(view, event) {
              if (!controller.isEditable()) return false;
              const text = event.clipboardData?.getData('text/plain').trim() ?? '';
              if (!text || /\s/.test(text) || !isHttpUrl(text)) return false;
              const { state } = view;
              const { selection } = state;
              if (selection.$from.parent.type.spec.code) return false;
              const linkType = state.schema.marks.link;
              if (!linkType) return false;
              const mark = linkType.create({ href: text });
              if (!selection.empty) {
                if (!(selection instanceof TextSelection)) return false;
                // A URL pasted over text links the text.
                view.dispatch(state.tr.addMark(selection.from, selection.to, mark));
                return true;
              }
              const from = selection.from;
              const tr = state.tr.insertText(text, from);
              tr.addMark(from, from + text.length, mark);
              tr.removeStoredMark(linkType);
              tr.setMeta(urlPasteKey, { from, to: from + text.length, url: text });
              view.dispatch(tr.scrollIntoView());
              return true;
            },
            handleKeyDown(view, event) {
              if (!urlPasteKey.getState(view.state) || controller.menu.get()?.kind !== 'paste')
                return false;
              const state = controller.menu.get();
              if (!state) return false;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                moveActive(controller, event.key === 'ArrowDown' ? 1 : -1);
                return true;
              }
              if (event.key === 'Enter') {
                const item = state.flat[state.active];
                if (item) state.select(item);
                return true;
              }
              if (event.key === 'Escape') {
                view.dispatch(view.state.tr.setMeta(urlPasteKey, null));
                return true;
              }
              return false;
            },
            handleClick(view, _pos, event) {
              const target = event.target instanceof Element ? event.target : null;
              const anchor = target?.closest('a.tess-link');
              if (!(anchor instanceof HTMLAnchorElement)) return false;
              if (event.metaKey || event.ctrlKey || !view.editable) {
                event.preventDefault();
                openHref(anchor.getAttribute('href'));
                return true;
              }
              return false;
            },
          },
        }),
      ];
    },
  });
}
