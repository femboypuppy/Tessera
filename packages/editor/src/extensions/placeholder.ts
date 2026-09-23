import { Extension } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../i18n';

interface PlaceholderState {
  focused: boolean;
}

export const placeholderPluginKey = new PluginKey<PlaceholderState>('tesseraPlaceholder');

/** True when the document is a single empty paragraph. */
export function isEmptyDoc(doc: PMNode): boolean {
  const first = doc.firstChild;
  return (
    doc.childCount === 1 && !!first && first.type.name === 'paragraph' && first.content.size === 0
  );
}

/** The hint for an empty textblock where the caret is, by what contains it. */
function hintFor($pos: ResolvedPos): string | null {
  const block = $pos.parent;
  if (block.type.name === 'heading') {
    const level = Number(block.attrs.level);
    return level === 2
      ? t('headingPlaceholder_2')
      : level === 3
        ? t('headingPlaceholder_3')
        : t('headingPlaceholder_1');
  }
  if (block.type.name === 'toggleSummary') return t('togglePlaceholder');
  if (block.type.name !== 'paragraph') return null;
  const container = $pos.depth > 1 ? $pos.node($pos.depth - 1) : null;
  switch (container?.type.name) {
    case 'listItem':
      return $pos.index($pos.depth - 1) === 0 ? t('listPlaceholder') : t('slashPlaceholder');
    case 'taskItem':
      return $pos.index($pos.depth - 1) === 0 ? t('taskPlaceholder') : t('slashPlaceholder');
    case 'blockquote':
      return t('quotePlaceholder');
    case 'callout':
      return t('calloutPlaceholder');
    case 'tableCell':
    case 'tableHeader':
      return null;
    default:
      return t('slashPlaceholder');
  }
}

const structuralCache = new WeakMap<PMNode, Decoration[]>();

/** Empty headings and toggle summaries always say what they are (cached per document). */
function structuralPlaceholders(doc: PMNode): Decoration[] {
  const cached = structuralCache.get(doc);
  if (cached) return cached;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.isTextblock) {
      if (
        node.content.size === 0 &&
        (node.type.name === 'heading' || node.type.name === 'toggleSummary')
      ) {
        const hint = hintFor(doc.resolve(pos + 1));
        if (hint) {
          decorations.push(
            Decoration.node(pos, pos + node.nodeSize, {
              class: 'tess-placeholder',
              'data-placeholder': hint,
            }),
          );
        }
      }
      return false;
    }
    return node.type.name !== 'codeBlock' && node.type.name !== 'table';
  });
  structuralCache.set(doc, decorations);
  return decorations;
}

function placeholderDecorations(state: EditorState, focused: boolean, editable: boolean) {
  const { doc, selection } = state;
  if (!editable) return DecorationSet.empty;
  if (isEmptyDoc(doc)) {
    const text = focused ? t('slashPlaceholder') : t('emptyPagePlaceholder');
    return DecorationSet.create(doc, [
      Decoration.node(0, doc.firstChild?.nodeSize ?? 2, {
        class: focused ? 'tess-placeholder' : 'tess-placeholder tess-placeholder-quiet',
        'data-placeholder': text,
      }),
    ]);
  }
  const decorations = [...structuralPlaceholders(doc)];
  // The block with the caret shows how to insert blocks.
  if (focused && selection.empty) {
    const { $from } = selection;
    const block = $from.parent;
    if (block.isTextblock && block.content.size === 0 && block.type.name === 'paragraph') {
      const hint = hintFor($from);
      if (hint) {
        const pos = $from.before();
        decorations.push(
          Decoration.node(pos, pos + block.nodeSize, {
            class: 'tess-placeholder',
            'data-placeholder': hint,
          }),
        );
      }
    }
  }
  return DecorationSet.create(doc, decorations);
}

/**
 * Placeholders: "Type '/' for commands" on the focused empty block, a quieter "Start writing…" on
 * an empty page, and the block type on empty headings, toggles, list items and quotes. Rendered
 * with CSS from `data-placeholder`, so they never enter the document.
 */
export const Placeholder = Extension.create({
  name: 'tesseraPlaceholder',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<PlaceholderState>({
        key: placeholderPluginKey,
        state: {
          init: () => ({ focused: false }),
          apply(tr, value) {
            const focused = tr.getMeta(placeholderPluginKey) as boolean | undefined;
            return focused === undefined || focused === value.focused ? value : { focused };
          },
        },
        props: {
          decorations(state) {
            const focused = placeholderPluginKey.getState(state)?.focused ?? false;
            return placeholderDecorations(state, focused, editor.isEditable);
          },
          handleDOMEvents: {
            focus(view) {
              view.dispatch(view.state.tr.setMeta(placeholderPluginKey, true));
              return false;
            },
            blur(view) {
              view.dispatch(view.state.tr.setMeta(placeholderPluginKey, false));
              return false;
            },
          },
        },
      }),
    ];
  },
});
