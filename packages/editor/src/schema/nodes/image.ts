import { ASSET_ID_PATTERN, isSafeImageSrc } from '@tessera/core';
import { mergeAttributes, Node } from '@tiptap/core';

/** Attributes of an `image` node (without `blockId`). */
export interface ImageAttributes {
  assetId?: string | null;
  src?: string | null;
  alt?: string | null;
  title?: string | null;
  width?: number | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    image: {
      /** Inserts an image (an `assetId` or a safe `src` is required). */
      insertImage: (attrs: ImageAttributes) => ReturnType;
    };
  }
}

/** Parses a stored width (a percentage of the content width, 10–100), or null. */
export function parseImageWidth(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(10, Math.round(number)));
}

function shortString(value: string | null, max = 2000): string | null {
  return value !== null && value.length <= max ? value : null;
}

/**
 * `image`: an atom block. Local images reference an `assetId` from the `AssetStore`; remote ones
 * use a safe `src`. `title` is the caption and `width` a percentage of the content width.
 */
export const Image = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      assetId: {
        default: null,
        parseHTML: (element) => {
          const id = element.getAttribute('data-asset-id');
          return id && ASSET_ID_PATTERN.test(id) ? id : null;
        },
        renderHTML: (attributes) =>
          attributes.assetId ? { 'data-asset-id': String(attributes.assetId) } : {},
      },
      src: {
        default: null,
        parseHTML: (element) => {
          const src = element.getAttribute('src');
          return isSafeImageSrc(src) ? src : null;
        },
        renderHTML: (attributes) =>
          isSafeImageSrc(attributes.src) ? { src: String(attributes.src) } : {},
      },
      alt: {
        default: null,
        parseHTML: (element) => shortString(element.getAttribute('alt')),
      },
      title: {
        default: null,
        parseHTML: (element) => shortString(element.getAttribute('title')),
      },
      width: {
        default: null,
        parseHTML: (element) => parseImageWidth(element.getAttribute('data-width')),
        renderHTML: (attributes) =>
          attributes.width ? { 'data-width': String(attributes.width) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src], img[data-asset-id]',
        getAttrs: (element) =>
          (element.getAttribute('data-asset-id') &&
            ASSET_ID_PATTERN.test(element.getAttribute('data-asset-id') ?? '')) ||
          isSafeImageSrc(element.getAttribute('src'))
            ? null
            : false,
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes(HTMLAttributes, { 'data-type': 'image' })];
  },

  addCommands() {
    return {
      insertImage:
        (attrs) =>
        ({ commands }) => {
          const assetId =
            attrs.assetId && ASSET_ID_PATTERN.test(attrs.assetId) ? attrs.assetId : null;
          const src = isSafeImageSrc(attrs.src) ? attrs.src : null;
          if (!assetId && !src) return false;
          return commands.insertContent({
            type: this.name,
            attrs: {
              assetId,
              src,
              alt: attrs.alt ?? null,
              title: attrs.title ?? null,
              width: parseImageWidth(attrs.width),
            },
          });
        },
    };
  },
});
