import { CALLOUT_TONES, type CalloutTone } from '@tessera/core';
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      /** Wraps the selected blocks in a callout. */
      setCallout: (attrs?: { emoji?: string; tone?: CalloutTone }) => ReturnType;
      /** Updates the callout around the selection (or at `pos`). */
      updateCallout: (attrs: { emoji?: string; tone?: CalloutTone }, pos?: number) => ReturnType;
    };
  }
}

export const DEFAULT_CALLOUT_EMOJI = '💡';

/** Returns a valid callout tone, or the default one. */
export function parseCalloutTone(value: unknown): CalloutTone {
  return (CALLOUT_TONES as readonly unknown[]).includes(value) ? (value as CalloutTone) : 'default';
}

/** Returns a short emoji string, or null. */
export function parseCalloutEmoji(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 32 ? value : null;
}

/**
 * `callout`: a colored box with an emoji and blocks inside (`block+`). The page editor adds a node
 * view with the emoji picker and tone menu.
 */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      emoji: {
        default: DEFAULT_CALLOUT_EMOJI,
        parseHTML: (element) =>
          parseCalloutEmoji(element.getAttribute('data-emoji')) ?? DEFAULT_CALLOUT_EMOJI,
        renderHTML: (attributes) =>
          attributes.emoji ? { 'data-emoji': String(attributes.emoji) } : {},
      },
      tone: {
        default: 'default',
        parseHTML: (element) => parseCalloutTone(element.getAttribute('data-tone')),
        renderHTML: (attributes) => ({ 'data-tone': parseCalloutTone(attributes.tone) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'aside[data-type="callout"]', contentElement: '[data-callout-content]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'aside',
      mergeAttributes(HTMLAttributes, { 'data-type': 'callout', class: 'tess-callout' }),
      [
        'span',
        { class: 'tess-callout-emoji', contenteditable: 'false' },
        String(node.attrs.emoji ?? ''),
      ],
      ['div', { class: 'tess-callout-content', 'data-callout-content': '' }, 0],
    ];
  },

  addCommands() {
    return {
      setCallout:
        (attrs = {}) =>
        ({ commands }) =>
          commands.wrapIn(this.name, {
            emoji: parseCalloutEmoji(attrs.emoji) ?? DEFAULT_CALLOUT_EMOJI,
            tone: parseCalloutTone(attrs.tone),
          }),
      updateCallout:
        (attrs, pos) =>
        ({ state, tr, dispatch }) => {
          let target = pos;
          if (target === undefined) {
            const { $from } = state.selection;
            for (let depth = $from.depth; depth > 0; depth -= 1) {
              if ($from.node(depth).type.name === this.name) {
                target = $from.before(depth);
                break;
              }
            }
          }
          if (target === undefined) return false;
          const node = state.doc.nodeAt(target);
          if (!node || node.type.name !== this.name) return false;
          if (dispatch) {
            const next = { ...node.attrs };
            if (attrs.emoji !== undefined)
              next.emoji = parseCalloutEmoji(attrs.emoji) ?? DEFAULT_CALLOUT_EMOJI;
            if (attrs.tone !== undefined) next.tone = parseCalloutTone(attrs.tone);
            tr.setNodeMarkup(target, undefined, next);
          }
          return true;
        },
    };
  },
});
