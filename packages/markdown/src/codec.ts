import {
  normalizeDocJSON,
  type DocJSON,
  type JsonValue,
  type MarkdownCodec,
  type MarkdownParseOptions,
  type MarkdownParseResult,
  type MarkdownSerializeOptions,
} from '@tessera/core';
import type { Root } from 'mdast';
import type { Join, Options as ToMarkdownOptions } from 'mdast-util-to-markdown';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified, type Processor } from 'unified';
import { docToMdast } from './from-doc';
import { parseFrontmatter } from './frontmatter';
import { parseHtmlToDoc } from './html/parse-html';
import { tesseraFromMarkdown, tesseraToMarkdown } from './syntax/mdast';
import { tesseraSyntax } from './syntax/micromark';
import { createContext, mdastToDoc, type ToDocOptions } from './to-doc';

/** Parse options of the Tessera codec: the contract's, plus hints importers can give. */
export interface TesseraParseOptions extends MarkdownParseOptions {
  /** Tells database pages apart, so `![[Database]]` becomes an inline database. */
  isDatabase?: (pageId: string) => boolean;
}

/** remark plugin registering the Tessera syntax (wikilinks, embeds, tags, highlights, block IDs). */
export function remarkTessera(this: Processor): void {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(tesseraSyntax());
  (data.fromMarkdownExtensions ??= []).push(tesseraFromMarkdown());
  (data.toMarkdownExtensions ??= []).push(tesseraToMarkdown());
}

/**
 * Blank lines between blocks: tight lists, one blank line everywhere else (even inside list
 * items, so a paragraph never turns into a setext heading or swallows a table).
 */
const joinBlocks: Join = (left, right, parent) => {
  if (parent.type === 'list') return 0;
  if (parent.type === 'listItem') {
    // Only a bullet list, or a numbered one starting at 1, can directly follow a paragraph.
    const interrupts = right.type === 'list' && (!right.ordered || (right.start ?? 1) === 1);
    return left.type === 'paragraph' && interrupts ? 0 : 1;
  }
  return 1;
};

const STRINGIFY_OPTIONS: ToMarkdownOptions = {
  bullet: '-',
  bulletOther: '*',
  bulletOrdered: '.',
  emphasis: '*',
  strong: '*',
  fence: '`',
  fences: true,
  listItemIndent: 'one',
  rule: '-',
  setext: false,
  closeAtx: false,
  incrementListMarker: true,
  quote: '"',
  join: [joinBlocks],
  handlers: {
    // `---` as the very first line would read as a frontmatter fence.
    thematicBreak: (_node, parent) =>
      parent?.type === 'root' &&
      parent.children[0]?.type === 'thematicBreak' &&
      parent.children[0] === _node
        ? '***'
        : '---',
  },
};

function createProcessor() {
  return unified()
    .use(remarkParse)
    .use(remarkStringify, STRINGIFY_OPTIONS)
    .use(remarkGfm, { singleTilde: false })
    .use(remarkFrontmatter, ['yaml'])
    .use(remarkTessera)
    .freeze();
}

type TesseraProcessor = ReturnType<typeof createProcessor>;

/**
 * mdast-util-to-markdown encodes single UTF-16 units next to emphasis, which splits emoji and
 * other astral characters into a lone surrogate and a character reference. Join them back into
 * one reference to the whole code point.
 */
function repairSurrogates(markdown: string): string {
  return markdown
    .replace(
      /([\uD800-\uDBFF])&#x(D[C-F][0-9A-F]{2});/gi,
      (_match, high: string, low: string) =>
        `&#x${((high.charCodeAt(0) - 0xd800) * 0x400 + (Number.parseInt(low, 16) - 0xdc00) + 0x10000).toString(16).toUpperCase()};`,
    )
    .replace(
      /&#x(D[89AB][0-9A-F]{2});([\uDC00-\uDFFF])/gi,
      (_match, high: string, low: string) =>
        `&#x${((Number.parseInt(high, 16) - 0xd800) * 0x400 + (low.charCodeAt(0) - 0xdc00) + 0x10000).toString(16).toUpperCase()};`,
    );
}

function normalizeNewlines(value: string): string {
  const withoutBom = value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
  return withoutBom.replace(/\r\n?/g, '\n');
}

/**
 * The Tessera markdown codec: Obsidian-flavored markdown (GFM, frontmatter, wikilinks, embeds,
 * tags, callouts, highlights, block IDs, toggles as `<details>`) to and from the canonical
 * document schema, and sanitized HTML to documents. Deterministic: the same input always gives
 * the same output.
 *
 * @example
 * const codec = new RemarkMarkdownCodec();
 * const { doc, frontmatter } = codec.parse('# Hello [[World]]', { resolvePageLink: (t) => ids.get(t) });
 * codec.serialize(doc, { resolvePage: (id) => ({ title: titles.get(id) ?? '' }) });
 */
export class RemarkMarkdownCodec implements MarkdownCodec {
  private readonly processor: TesseraProcessor = createProcessor();

  /** Parses markdown into a syntax tree (for tools that need mdast). */
  parseTree(markdown: string): Root {
    return this.processor.parse(normalizeNewlines(markdown));
  }

  parse(markdown: string, options: TesseraParseOptions = {}): MarkdownParseResult {
    const source = normalizeNewlines(markdown);
    const tree = this.processor.parse(source);
    const warnings: string[] = [];
    let frontmatter: Record<string, JsonValue> = {};
    const yaml = tree.children[0];
    if (yaml?.type === 'yaml') {
      const parsed = parseFrontmatter(yaml.value);
      frontmatter = parsed.data;
      warnings.push(...parsed.warnings);
    }
    const toDocOptions: ToDocOptions = {
      resolvePageLink: options.resolvePageLink,
      resolveAsset: options.resolveAsset,
      isDatabase: options.isDatabase,
    };
    const ctx = createContext(toDocOptions, (nested) => this.processor.parse(nested), source);
    const doc = normalizeDocJSON(mdastToDoc(tree, ctx));
    return { doc, frontmatter, warnings: [...warnings, ...ctx.warnings] };
  }

  serialize(doc: DocJSON, options: MarkdownSerializeOptions = {}): string {
    const tree = docToMdast(normalizeDocJSON(doc), options);
    if (tree.children.length === 0) return '';
    return repairSurrogates(this.processor.stringify(tree));
  }

  parseHTML(html: string): DocJSON {
    return normalizeDocJSON(parseHtmlToDoc(html));
  }
}

/** Creates the codec (cheap; the parser is built once per instance). */
export function createMarkdownCodec(): RemarkMarkdownCodec {
  return new RemarkMarkdownCodec();
}
