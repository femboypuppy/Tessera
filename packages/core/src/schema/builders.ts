import type { JsonValue } from '../json';
import type {
  BlockColor,
  BlockJSON,
  BlockquoteJSON,
  BulletListJSON,
  CalloutJSON,
  CalloutTone,
  CodeBlockJSON,
  DocJSON,
  EmbedJSON,
  HardBreakJSON,
  HeadingJSON,
  HighlightColor,
  HorizontalRuleJSON,
  ImageJSON,
  InlineJSON,
  ListItemJSON,
  MarkJSON,
  OrderedListJSON,
  PageLinkJSON,
  ParagraphJSON,
  TableCellJSON,
  TableJSON,
  TableRowJSON,
  TagJSON,
  TaskItemJSON,
  TaskListJSON,
  TextJSON,
  ToggleJSON,
  ToggleSummaryJSON,
} from './types';

type Inline = string | InlineJSON;
type Block = string | BlockJSON;

function inline(items: readonly Inline[]): InlineJSON[] | undefined {
  const nodes = items
    .map((item) => (typeof item === 'string' ? (item ? text(item) : null) : item))
    .filter((node): node is InlineJSON => node !== null);
  return nodes.length ? nodes : undefined;
}

function blocks(items: readonly Block[]): BlockJSON[] {
  return items.map((item) => (typeof item === 'string' ? paragraph(item) : item));
}

function withContent<T extends { content?: InlineJSON[] }>(node: T, items: readonly Inline[]): T {
  const content = inline(items);
  if (content) node.content = content;
  return node;
}

/** A text node with optional marks. */
export function text(value: string, ...marks: MarkJSON[]): TextJSON {
  return marks.length ? { type: 'text', text: value, marks } : { type: 'text', text: value };
}

/** A document. Strings become paragraphs. */
export function doc(...content: Block[]): DocJSON {
  return { type: 'doc', content: content.length ? blocks(content) : [paragraph()] };
}

export function paragraph(...content: Inline[]): ParagraphJSON {
  return withContent<ParagraphJSON>({ type: 'paragraph' }, content);
}

export function heading(level: 1 | 2 | 3, ...content: Inline[]): HeadingJSON {
  return withContent<HeadingJSON>({ type: 'heading', attrs: { level } }, content);
}

export function blockquote(...content: Block[]): BlockquoteJSON {
  return { type: 'blockquote', content: blocks(content) };
}

export function callout(
  attrs: { emoji?: string | null; tone?: CalloutTone },
  ...content: Block[]
): CalloutJSON {
  return { type: 'callout', attrs, content: blocks(content) };
}

export function codeBlock(code: string, language: string | null = null): CodeBlockJSON {
  const node: CodeBlockJSON = { type: 'codeBlock', attrs: { language } };
  if (code) node.content = [text(code)];
  return node;
}

export function horizontalRule(): HorizontalRuleJSON {
  return { type: 'horizontalRule' };
}

export function image(attrs: ImageJSON['attrs']): ImageJSON {
  return { type: 'image', attrs };
}

/** A list item: strings become paragraphs; the first child must be a paragraph. */
export function listItem(...content: Block[]): ListItemJSON {
  return { type: 'listItem', content: blocks(content.length ? content : ['']) };
}

/** A bullet list; strings become single-paragraph items. */
export function bulletList(...items: Array<string | ListItemJSON>): BulletListJSON {
  return {
    type: 'bulletList',
    content: items.map((item) => (typeof item === 'string' ? listItem(item) : item)),
  };
}

/** An ordered list; strings become single-paragraph items. */
export function orderedList(...items: Array<string | ListItemJSON>): OrderedListJSON {
  return {
    type: 'orderedList',
    content: items.map((item) => (typeof item === 'string' ? listItem(item) : item)),
  };
}

export function taskItem(checked: boolean, ...content: Block[]): TaskItemJSON {
  return { type: 'taskItem', attrs: { checked }, content: blocks(content.length ? content : ['']) };
}

export function taskList(...items: TaskItemJSON[]): TaskListJSON {
  return { type: 'taskList', content: items };
}

/** A cell: strings become paragraphs. */
export function tableCell(...content: Array<string | ParagraphJSON>): TableCellJSON {
  return {
    type: 'tableCell',
    content: (content.length ? content : ['']).map((item) =>
      typeof item === 'string' ? paragraph(item) : item,
    ),
  };
}

export function tableHeader(...content: Array<string | ParagraphJSON>): TableCellJSON {
  return { ...tableCell(...content), type: 'tableHeader' };
}

export function tableRow(...cells: Array<string | TableCellJSON>): TableRowJSON {
  return {
    type: 'tableRow',
    content: cells.map((cell) => (typeof cell === 'string' ? tableCell(cell) : cell)),
  };
}

/**
 * A table. With `header: true`, the first row's string cells become header cells.
 *
 * @example
 * table({ header: true }, ['Name', 'Status'], ['Spec', 'Done']);
 */
export function table(
  options: { header?: boolean },
  ...rows: Array<Array<string | TableCellJSON>>
): TableJSON {
  return {
    type: 'table',
    content: rows.map((cells, index) =>
      tableRow(
        ...cells.map((cell) =>
          typeof cell === 'string' && options.header && index === 0 ? tableHeader(cell) : cell,
        ),
      ),
    ),
  };
}

export function toggleSummary(...content: Inline[]): ToggleSummaryJSON {
  return withContent<ToggleSummaryJSON>({ type: 'toggleSummary' }, content);
}

/** A toggle: a summary line (string or inline nodes) and the blocks it hides. */
export function toggle(
  summary: string | Inline[],
  body: Block[] = [],
  attrs: { open?: boolean } = {},
): ToggleJSON {
  return {
    type: 'toggle',
    attrs,
    content: [
      toggleSummary(...(typeof summary === 'string' ? [summary] : summary)),
      ...blocks(body),
    ],
  };
}

export function embed(
  kind: string,
  ref: string | null = null,
  data: JsonValue | null = null,
): EmbedJSON {
  return { type: 'embed', attrs: { kind, ref, data } };
}

export function pageLink(
  pageId: string,
  attrs: Omit<PageLinkJSON['attrs'], 'pageId'> = {},
): PageLinkJSON {
  return { type: 'pageLink', attrs: { pageId, ...attrs } };
}

export function tag(name: string): TagJSON {
  return { type: 'tag', attrs: { name } };
}

export function hardBreak(): HardBreakJSON {
  return { type: 'hardBreak' };
}

/** Mark helpers. */
export const mark = {
  bold: (): MarkJSON => ({ type: 'bold' }),
  italic: (): MarkJSON => ({ type: 'italic' }),
  underline: (): MarkJSON => ({ type: 'underline' }),
  strike: (): MarkJSON => ({ type: 'strike' }),
  code: (): MarkJSON => ({ type: 'code' }),
  link: (href: string, title: string | null = null): MarkJSON => ({
    type: 'link',
    attrs: { href, title },
  }),
  highlight: (color: HighlightColor | null = null): MarkJSON => ({
    type: 'highlight',
    attrs: { color },
  }),
};

/** Sets the color of a colorable block (returns a copy). */
export function colored<T extends BlockJSON & { attrs?: { color?: BlockColor | null } }>(
  node: T,
  color: BlockColor,
): T {
  return { ...node, attrs: { ...node.attrs, color } };
}

/**
 * Typed DocJSON builders for tests, importers and examples.
 *
 * @example
 * import { build } from '@tessera/core';
 * const d = build.doc(
 *   build.heading(1, 'Launch'),
 *   build.paragraph('See ', build.pageLink(specId), ' and ', build.text('ship it', build.mark.bold())),
 *   build.taskList(build.taskItem(false, 'Write the post')),
 * );
 */
export const build = {
  doc,
  text,
  paragraph,
  p: paragraph,
  heading,
  blockquote,
  callout,
  codeBlock,
  horizontalRule,
  image,
  bulletList,
  orderedList,
  listItem,
  taskList,
  taskItem,
  table,
  tableRow,
  tableCell,
  tableHeader,
  toggle,
  toggleSummary,
  embed,
  pageLink,
  tag,
  hardBreak,
  mark,
  colored,
};
