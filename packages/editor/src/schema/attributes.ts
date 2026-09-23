import { BLOCK_COLORS, isValidBlockId, type BlockColor } from '@tessera/core';
import { Extension } from '@tiptap/core';

/** Node types with a `blockId` attribute (canonical schema, SPEC 5.1). */
export const BLOCK_ID_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'callout',
  'codeBlock',
  'image',
  'listItem',
  'taskItem',
  'table',
  'toggle',
  'embed',
] as const;

/** Node types with a `color` attribute (Notion block colors). */
export const COLOR_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'listItem',
  'taskItem',
  'toggle',
] as const;

/** Returns the value when it is a valid block color, else null. */
export function parseBlockColor(value: unknown): BlockColor | null {
  return typeof value === 'string' && (BLOCK_COLORS as readonly string[]).includes(value)
    ? (value as BlockColor)
    : null;
}

/** Returns the value when it is a valid block ID, else null. */
export function parseBlockId(value: unknown): string | null {
  return isValidBlockId(value) ? value : null;
}

/**
 * Adds `blockId` and `color` to the node types that have them. Neither is kept when a block is
 * split: the new block gets a fresh ID from the block-ID plugin and starts without a color.
 */
export const BlockAttributes = Extension.create({
  name: 'blockAttributes',
  addGlobalAttributes() {
    return [
      {
        types: [...BLOCK_ID_TYPES],
        attributes: {
          blockId: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => parseBlockId(element.getAttribute('data-block-id')),
            renderHTML: (attributes) =>
              attributes.blockId ? { 'data-block-id': String(attributes.blockId) } : {},
          },
        },
      },
      {
        types: [...COLOR_TYPES],
        attributes: {
          color: {
            default: null,
            keepOnSplit: false,
            parseHTML: (element) => parseBlockColor(element.getAttribute('data-color')),
            renderHTML: (attributes) =>
              attributes.color ? { 'data-color': String(attributes.color) } : {},
          },
        },
      },
    ];
  },
});
