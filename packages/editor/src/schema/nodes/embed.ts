import {
  isHttpUrl,
  isJsonValue,
  isValidEmbedKind,
  MAX_EMBED_DATA_BYTES,
  type EmbedInsert,
  type JsonValue,
} from '@tessera/core';
import { mergeAttributes, Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** Inserts an embed block (validated: kind, JSON data size, http(s) URL for `web`). */
      insertEmbed: (embed: EmbedInsert) => ReturnType;
    };
  }
}

/** Parses embed data from JSON text, keeping only valid JSON under the size limit. */
export function parseEmbedData(raw: string | null): JsonValue | null {
  if (!raw || raw.length > MAX_EMBED_DATA_BYTES) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isJsonValue(value) ? value : null;
  } catch {
    return null;
  }
}

/** True when an embed can be stored: a valid kind, data under 64 KB and a URL for `web`. */
export function isValidEmbed(embed: EmbedInsert): boolean {
  if (!isValidEmbedKind(embed.kind)) return false;
  if (embed.ref !== undefined && embed.ref !== null && typeof embed.ref !== 'string') return false;
  if (typeof embed.ref === 'string' && embed.ref.length > 4096) return false;
  if (embed.kind === 'web' && !isHttpUrl(embed.ref)) return false;
  if (embed.data !== undefined && embed.data !== null) {
    if (!isJsonValue(embed.data)) return false;
    if (JSON.stringify(embed.data).length > MAX_EMBED_DATA_BYTES) return false;
  }
  return true;
}

/**
 * `embed`: the extension block. `kind` picks a renderer from the `BlockRendererRegistry`; the
 * page editor's node view renders it, or a "needs a plugin" placeholder for unknown kinds.
 */
export const Embed = Node.create({
  name: 'embed',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      kind: {
        default: null,
        parseHTML: (element) => {
          const kind = element.getAttribute('data-kind');
          return isValidEmbedKind(kind) ? kind : null;
        },
        renderHTML: (attributes) =>
          attributes.kind ? { 'data-kind': String(attributes.kind) } : {},
      },
      ref: {
        default: null,
        parseHTML: (element) => {
          const ref = element.getAttribute('data-ref');
          return ref && ref.length <= 4096 ? ref : null;
        },
        renderHTML: (attributes) => (attributes.ref ? { 'data-ref': String(attributes.ref) } : {}),
      },
      data: {
        default: null,
        parseHTML: (element) => parseEmbedData(element.getAttribute('data-embed')),
        renderHTML: (attributes) =>
          attributes.data === null || attributes.data === undefined
            ? {}
            : { 'data-embed': JSON.stringify(attributes.data) },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="embed"]',
        getAttrs: (element) => {
          const kind = element.getAttribute('data-kind');
          if (!isValidEmbedKind(kind)) return false;
          const ref = element.getAttribute('data-ref');
          if (kind === 'web' && !isHttpUrl(ref)) return false;
          return null;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const ref = typeof node.attrs.ref === 'string' ? node.attrs.ref : null;
    const label = ref && isHttpUrl(ref) ? ['a', { href: ref }, ref] : String(node.attrs.kind ?? '');
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'embed' }), label];
  },

  addCommands() {
    return {
      insertEmbed:
        (embed) =>
        ({ commands }) => {
          if (!isValidEmbed(embed)) return false;
          return commands.insertContent({
            type: this.name,
            attrs: { kind: embed.kind, ref: embed.ref ?? null, data: embed.data ?? null },
          });
        },
    };
  },
});
