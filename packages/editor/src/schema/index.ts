import type { AnyExtension } from '@tiptap/core';
import { Blockquote } from '@tiptap/extension-blockquote';
import { CodeBlock as BaseCodeBlock } from '@tiptap/extension-code-block';
import { Document } from '@tiptap/extension-document';
import { HardBreak } from '@tiptap/extension-hard-break';
import { Heading } from '@tiptap/extension-heading';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import {
  BulletList,
  ListItem,
  ListKeymap,
  OrderedList as BaseOrderedList,
  TaskItem,
  TaskList,
} from '@tiptap/extension-list';
import { Paragraph } from '@tiptap/extension-paragraph';
import {
  Table,
  TableCell as BaseTableCell,
  TableHeader as BaseTableHeader,
  TableRow,
} from '@tiptap/extension-table';
import { Text } from '@tiptap/extension-text';
import { t } from '../i18n';
import { BlockAttributes } from './attributes';
import { Bold, Code, Highlight, Italic, Link, Strike, Underline } from './marks';
import { Callout } from './nodes/callout';
import { Embed } from './nodes/embed';
import { Image } from './nodes/image';
import { PageLink, Tag } from './nodes/inline';
import { Toggle, ToggleSummary } from './nodes/toggle';

export * from './attributes';
export * from './marks';
export * from './nodes/callout';
export * from './nodes/embed';
export * from './nodes/image';
export * from './nodes/inline';
export * from './nodes/toggle';

const LANGUAGE_PATTERN = /^[a-z0-9_+#.-]{1,64}$/;

/** Normalizes a code language (`TypeScript` → `typescript`), or null when invalid. */
export function parseCodeLanguage(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const language = value.trim().toLowerCase();
  return LANGUAGE_PATTERN.test(language) ? language : null;
}

/** `codeBlock` with a validated `language`. Highlighting is a separate plugin. */
export const CodeBlock = BaseCodeBlock.extend({
  addAttributes() {
    return {
      language: {
        default: null,
        parseHTML: (element) => {
          const fromData = element.getAttribute('data-language');
          if (fromData) return parseCodeLanguage(fromData);
          const code = element.querySelector('code') ?? element;
          const className = [...code.classList].find((name) => name.startsWith('language-'));
          return className ? parseCodeLanguage(className.slice('language-'.length)) : null;
        },
        renderHTML: (attributes) =>
          attributes.language ? { 'data-language': String(attributes.language) } : {},
      },
    };
  },
}).configure({ defaultLanguage: null, enableTabIndentation: true, tabSize: 2 });

/** `orderedList` keeps only `start` (TipTap adds a `type` attribute the schema doesn't have). */
export const OrderedList = BaseOrderedList.extend({
  addAttributes() {
    return {
      start: {
        default: 1,
        parseHTML: (element) => {
          const start = Number.parseInt(element.getAttribute('start') ?? '', 10);
          return Number.isInteger(start) && start >= 0 && start <= 1_000_000 ? start : 1;
        },
        renderHTML: (attributes) =>
          attributes.start && attributes.start !== 1 ? { start: String(attributes.start) } : {},
      },
    };
  },
});

function parseSpan(value: string | null): number {
  const span = Number.parseInt(value ?? '', 10);
  return Number.isInteger(span) && span >= 1 && span <= 1000 ? span : 1;
}

/** Parses `colwidth="120,80"` (or a `<col>` width) into valid pixel widths, or null. */
export function parseColwidth(element: HTMLElement): number[] | null {
  const raw = element.getAttribute('colwidth') ?? element.getAttribute('data-colwidth');
  if (!raw) return null;
  const widths = raw.split(',').map((width) => Number.parseInt(width, 10));
  return widths.length > 0 &&
    widths.every((width) => Number.isInteger(width) && width >= 1 && width <= 10_000)
    ? widths
    : null;
}

/** Exactly the canonical cell attributes (TipTap adds `align`, which the schema doesn't have). */
const cellAttributes = () => ({
  colspan: {
    default: 1,
    parseHTML: (element: HTMLElement) => parseSpan(element.getAttribute('colspan')),
  },
  rowspan: {
    default: 1,
    parseHTML: (element: HTMLElement) => parseSpan(element.getAttribute('rowspan')),
  },
  colwidth: {
    default: null,
    parseHTML: parseColwidth,
    renderHTML: (attributes: Record<string, unknown>) =>
      Array.isArray(attributes.colwidth) ? { colwidth: attributes.colwidth.join(',') } : {},
  },
});

/** Table cells hold paragraphs only, so tables map to GFM markdown. */
export const TableCell = BaseTableCell.extend({
  content: 'paragraph+',
  addAttributes: cellAttributes,
});
export const TableHeader = BaseTableHeader.extend({
  content: 'paragraph+',
  addAttributes: cellAttributes,
});

/** Options of {@link schemaExtensions}. */
export interface SchemaExtensionsOptions {
  /** Makes table columns resizable (needs a DOM; the page editor turns it on). */
  resizableTables?: boolean;
}

/**
 * Every node and mark of the canonical schema as TipTap extensions, with their commands,
 * keyboard shortcuts and markdown input rules. The page editor extends some of them with node
 * views; the conformance test checks that the result equals `SCHEMA_DESCRIPTION`.
 */
export function schemaExtensions(options: SchemaExtensionsOptions = {}): AnyExtension[] {
  return [
    Document,
    Paragraph,
    Text,
    Heading.configure({ levels: [1, 2, 3] }),
    Blockquote,
    Callout,
    CodeBlock,
    HorizontalRule,
    Image,
    BulletList,
    OrderedList,
    ListItem,
    ListKeymap,
    TaskList,
    TaskItem.configure({
      nested: true,
      a11y: {
        checkboxLabel: (node, checked) =>
          t(checked ? 'taskMarkUndone' : 'taskMarkDone', {
            text: node.textContent.trim() || t('taskUntitled'),
          }),
      },
    }),
    Table.configure({ resizable: options.resizableTables ?? false, allowTableNodeSelection: true }),
    TableRow,
    TableHeader,
    TableCell,
    Toggle,
    ToggleSummary,
    Embed,
    PageLink,
    Tag,
    HardBreak,
    Bold,
    Italic,
    Underline,
    Strike,
    Code,
    Link,
    Highlight,
    BlockAttributes,
  ];
}
