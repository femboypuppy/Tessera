import { Extension } from '@tiptap/core';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { t } from '../i18n';
import { changedRanges } from './changed-ranges';

interface PlaceholderState {
  focused: boolean;
  /** Placeholders of empty headings and toggle summaries, kept up to date incrementally. */
  structural: DecorationSet;
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

/** Empty headings and toggle summaries always say what they are. */
function structuralPlaceholder(node: PMNode, pos: number, doc: PMNode): Decoration | null {
  if (
    node.content.size !== 0 ||
    (node.type.name !== 'heading' && node.type.name !== 'toggleSummary')
  )
    return null;
  const hint = hintFor(doc.resolve(pos + 1));
  return hint
    ? Decoration.node(pos, pos + node.nodeSize, {
        class: 'tess-placeholder',
        'data-placeholder': hint,
      })
    : null;
}

/** Structural placeholders for the textblocks between `from` and `to`. */
function structuralPlaceholders(doc: PMNode, from = 0, to = doc.content.size): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (node.isTextblock) {
      const decoration = structuralPlaceholder(node, pos, doc);
      if (decoration) decorations.push(decoration);
      return false;
    }
    return node.type.name !== 'codeBlock' && node.type.name !== 'table';
  });
  return decorations;
}

/** Updates the structural placeholders for a change, looking only at what it touched. */
function updateStructural(tr: Transaction, previous: DecorationSet): DecorationSet {
  let set = previous.map(tr.mapping, tr.doc);
  const size = tr.doc.content.size;
  for (const range of changedRanges([tr])) {
    const from = Math.min(range.from, size);
    const to = Math.min(range.to, size);
    set = set.remove(set.find(from, to));
    set = set.add(tr.doc, structuralPlaceholders(tr.doc, from, to));
  }
  return set;
}

function placeholderDecorations(
  state: EditorState,
  { focused, structural }: PlaceholderState,
  editable: boolean,
): DecorationSet {
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
  // The block with the caret shows how to insert blocks.
  if (focused && selection.empty) {
    const { $from } = selection;
    const block = $from.parent;
    if (block.isTextblock && block.content.size === 0 && block.type.name === 'paragraph') {
      const hint = hintFor($from);
      if (hint) {
        const pos = $from.before();
        return structural.add(doc, [
          Decoration.node(pos, pos + block.nodeSize, {
            class: 'tess-placeholder',
            'data-placeholder': hint,
          }),
        ]);
      }
    }
  }
  return structural;
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
          init: (_config, state) => ({
            focused: false,
            structural: DecorationSet.create(state.doc, structuralPlaceholders(state.doc)),
          }),
          apply(tr, value) {
            const meta = tr.getMeta(placeholderPluginKey) as boolean | undefined;
            const focused = meta ?? value.focused;
            const structural = tr.docChanged
              ? updateStructural(tr, value.structural)
              : value.structural;
            return focused === value.focused && structural === value.structural
              ? value
              : { focused, structural };
          },
        },
        props: {
          decorations(state) {
            const value = placeholderPluginKey.getState(state);
            return value ? placeholderDecorations(state, value, editor.isEditable) : null;
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
