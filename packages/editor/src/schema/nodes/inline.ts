import { isValidBlockId, isValidId, isValidTagName, normalizeTagName } from '@tessera/core';
import { InputRule, mergeAttributes, Node } from '@tiptap/core';

/** Attributes of a `pageLink` node. */
export interface PageLinkAttributes {
  pageId: string;
  label?: string | null;
  heading?: string | null;
  blockRef?: string | null;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageLink: {
      /** Inserts a link to a page at the selection. */
      insertPageLink: (attrs: PageLinkAttributes) => ReturnType;
    };
    tag: {
      /** Inserts a `#tag` at the selection (the name is normalized; invalid names fail). */
      insertTag: (name: string) => ReturnType;
    };
  }
}

/** `#name` then a space, at the start of a block or after whitespace. */
export const TAG_INPUT_REGEX = /(?:^|\s)(#([\p{L}\p{M}\p{N}_/-]+))\s$/u;

function optionalText(value: string | null): string | null {
  return value && value.length <= 2000 ? value : null;
}

/**
 * `pageLink`: an inline atom that stores the target page ID; it renders the page's current title,
 * so renames propagate. `label` overrides the text, `heading` and `blockRef` point inside the page.
 */
export const PageLink = Node.create({
  name: 'pageLink',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      pageId: {
        default: null,
        parseHTML: (element) => {
          const id = element.getAttribute('data-page-id');
          return isValidId(id) ? id : null;
        },
        renderHTML: (attributes) => ({ 'data-page-id': String(attributes.pageId ?? '') }),
      },
      label: {
        default: null,
        parseHTML: (element) => optionalText(element.getAttribute('data-label')),
        renderHTML: (attributes) =>
          attributes.label ? { 'data-label': String(attributes.label) } : {},
      },
      heading: {
        default: null,
        parseHTML: (element) => optionalText(element.getAttribute('data-heading')),
        renderHTML: (attributes) =>
          attributes.heading ? { 'data-heading': String(attributes.heading) } : {},
      },
      blockRef: {
        default: null,
        parseHTML: (element) => {
          const ref = element.getAttribute('data-block-ref');
          return isValidBlockId(ref) ? ref : null;
        },
        renderHTML: (attributes) =>
          attributes.blockRef ? { 'data-block-ref': String(attributes.blockRef) } : {},
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: '[data-type="page-link"]',
        priority: 60,
        getAttrs: (element) => (isValidId(element.getAttribute('data-page-id')) ? null : false),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const pageId = String(node.attrs.pageId ?? '');
    return [
      'a',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'page-link',
        href: `/p/${encodeURIComponent(pageId)}`,
      }),
      String(node.attrs.label ?? ''),
    ];
  },

  renderText({ node }) {
    return node.attrs.label ? `[[${String(node.attrs.label)}]]` : '[[]]';
  },

  addCommands() {
    return {
      insertPageLink:
        (attrs) =>
        ({ commands }) => {
          if (!isValidId(attrs.pageId)) return false;
          return commands.insertContent({
            type: this.name,
            attrs: {
              pageId: attrs.pageId,
              label: attrs.label ?? null,
              heading: attrs.heading ?? null,
              blockRef: isValidBlockId(attrs.blockRef) ? attrs.blockRef : null,
            },
          });
        },
    };
  },
});

/** `tag`: an inline `#tag` atom. `name` has no `#`. */
export const Tag = Node.create({
  name: 'tag',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      name: {
        default: null,
        parseHTML: (element) => {
          const name = element.getAttribute('data-name');
          return isValidTagName(name) ? name : null;
        },
        renderHTML: (attributes) => ({ 'data-name': String(attributes.name ?? '') }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: '[data-type="tag"]',
        priority: 60,
        getAttrs: (element) => (isValidTagName(element.getAttribute('data-name')) ? null : false),
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-type': 'tag', class: 'tess-tag' }),
      `#${String(node.attrs.name ?? '')}`,
    ];
  },

  renderText({ node }) {
    return `#${String(node.attrs.name ?? '')}`;
  },

  addInputRules() {
    return [
      new InputRule({
        // `#name` followed by a space becomes a tag; invalid names (`#1984`) stay text.
        find: TAG_INPUT_REGEX,
        handler: ({ state, range, match }) => {
          const name = normalizeTagName(match[2] ?? '');
          const full = match[0];
          if (!name) return null;
          const from = range.from + full.indexOf('#');
          state.tr.replaceWith(from, range.to, [
            this.type.create({ name }),
            state.schema.text(' '),
          ]);
          return undefined;
        },
      }),
    ];
  },

  addCommands() {
    return {
      insertTag:
        (name) =>
        ({ commands }) => {
          const normalized = normalizeTagName(name);
          if (!normalized) return false;
          return commands.insertContent({ type: this.name, attrs: { name: normalized } });
        },
    };
  },
});
