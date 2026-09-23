import { Schema, type MarkSpec, type NodeSpec } from 'prosemirror-model';

/**
 * The canonical document schema. The editor (TipTap), the markdown codec, importers, exporters,
 * indexers and plugins all use exactly these node and mark names, attributes and content rules.
 * No DOM is required: `toDOM`/`parseDOM` belong to the editor.
 *
 * | node            | group        | content                    | attributes (default)                                               |
 * |-----------------|--------------|----------------------------|--------------------------------------------------------------------|
 * | `doc`           |              | `block+`                   |                                                                    |
 * | `paragraph`     | block        | `inline*`                  | blockId (null), color (null)                                       |
 * | `heading`       | block        | `inline*`                  | level (1), blockId, color                                          |
 * | `blockquote`    | block        | `block+`                   | blockId, color                                                     |
 * | `callout`       | block        | `block+`                   | emoji ('💡'), tone ('default'), blockId                              |
 * | `codeBlock`     | block        | `text*` (no marks)         | language (null), blockId                                           |
 * | `horizontalRule`| block        | leaf                       |                                                                    |
 * | `image`         | block        | atom                       | assetId, src, alt, title, width (all null), blockId                |
 * | `bulletList`    | block list   | `listItem+`                |                                                                    |
 * | `orderedList`   | block list   | `listItem+`                | start (1)                                                          |
 * | `listItem`      |              | `paragraph block*`         | blockId, color                                                     |
 * | `taskList`      | block list   | `taskItem+`                |                                                                    |
 * | `taskItem`      |              | `paragraph block*`         | checked (false), blockId, color                                    |
 * | `table`         | block        | `tableRow+`                | blockId                                                            |
 * | `tableRow`      |              | `(tableCell \| tableHeader)*` |                                                                 |
 * | `tableHeader`   |              | `paragraph+`               | colspan (1), rowspan (1), colwidth (null)                          |
 * | `tableCell`     |              | `paragraph+`               | colspan (1), rowspan (1), colwidth (null)                          |
 * | `toggle`        | block        | `toggleSummary block*`     | open (false), blockId, color                                       |
 * | `toggleSummary` |              | `inline*`                  |                                                                    |
 * | `embed`         | block        | atom                       | kind (null), ref (null), data (null), blockId                      |
 * | `text`          | inline       |                            |                                                                    |
 * | `pageLink`      | inline       | atom                       | pageId (null), label (null), heading (null), blockRef (null)        |
 * | `tag`           | inline       | atom                       | name (null)                                                        |
 * | `hardBreak`     | inline       | leaf                       |                                                                    |
 *
 * | mark        | attributes              | notes                        |
 * |-------------|-------------------------|------------------------------|
 * | `bold`      |                         |                              |
 * | `italic`    |                         |                              |
 * | `underline` |                         |                              |
 * | `strike`    |                         |                              |
 * | `code`      |                         | excludes every other mark    |
 * | `link`      | href (null), title (null) | not inclusive              |
 * | `highlight` | color (null = yellow)   |                              |
 */

const blockId = { blockId: { default: null } };
const colorAttrs = { ...blockId, color: { default: null } };
const cellAttrs = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
};

/** Node specs of the canonical schema, in schema order (paragraph first: the default block). */
export const nodeSpecs = {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'inline*', attrs: colorAttrs },
  heading: {
    group: 'block',
    content: 'inline*',
    defining: true,
    attrs: { level: { default: 1 }, ...colorAttrs },
  },
  blockquote: { group: 'block', content: 'block+', defining: true, attrs: colorAttrs },
  callout: {
    group: 'block',
    content: 'block+',
    defining: true,
    attrs: { emoji: { default: '💡' }, tone: { default: 'default' }, ...blockId },
  },
  codeBlock: {
    group: 'block',
    content: 'text*',
    marks: '',
    code: true,
    defining: true,
    attrs: { language: { default: null }, ...blockId },
  },
  horizontalRule: { group: 'block' },
  image: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: {
      assetId: { default: null },
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      ...blockId,
    },
  },
  bulletList: { group: 'block list', content: 'listItem+' },
  orderedList: { group: 'block list', content: 'listItem+', attrs: { start: { default: 1 } } },
  listItem: { content: 'paragraph block*', defining: true, attrs: colorAttrs },
  taskList: { group: 'block list', content: 'taskItem+' },
  taskItem: {
    content: 'paragraph block*',
    defining: true,
    attrs: { checked: { default: false }, ...colorAttrs },
  },
  table: {
    group: 'block',
    content: 'tableRow+',
    tableRole: 'table',
    isolating: true,
    attrs: blockId,
  },
  tableRow: { content: '(tableCell | tableHeader)*', tableRole: 'row' },
  tableHeader: {
    content: 'paragraph+',
    tableRole: 'header_cell',
    isolating: true,
    attrs: cellAttrs,
  },
  tableCell: { content: 'paragraph+', tableRole: 'cell', isolating: true, attrs: cellAttrs },
  toggle: {
    group: 'block',
    content: 'toggleSummary block*',
    defining: true,
    attrs: { open: { default: false }, ...colorAttrs },
  },
  toggleSummary: { content: 'inline*' },
  embed: {
    group: 'block',
    atom: true,
    draggable: true,
    attrs: { kind: { default: null }, ref: { default: null }, data: { default: null }, ...blockId },
  },
  text: { group: 'inline' },
  pageLink: {
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {
      pageId: { default: null },
      label: { default: null },
      heading: { default: null },
      blockRef: { default: null },
    },
  },
  tag: { group: 'inline', inline: true, atom: true, attrs: { name: { default: null } } },
  hardBreak: { group: 'inline', inline: true, selectable: false, linebreakReplacement: true },
} satisfies Record<string, NodeSpec>;

/** Mark specs of the canonical schema. */
export const markSpecs = {
  link: {
    attrs: { href: { default: null }, title: { default: null } },
    inclusive: false,
  },
  bold: {},
  italic: {},
  underline: {},
  strike: {},
  code: { excludes: '_', code: true },
  highlight: { attrs: { color: { default: null } } },
} satisfies Record<string, MarkSpec>;

/**
 * The canonical ProseMirror schema.
 *
 * @example
 * const node = tesseraSchema.nodeFromJSON(docJson);
 * node.check(); // throws if the content breaks the schema
 */
export const tesseraSchema = new Schema({ nodes: nodeSpecs, marks: markSpecs, topNode: 'doc' });

/** Names of every node type. */
export const NODE_NAMES = Object.keys(nodeSpecs) as Array<keyof typeof nodeSpecs>;

/** Names of every mark type. */
export const MARK_NAMES = Object.keys(markSpecs) as Array<keyof typeof markSpecs>;
