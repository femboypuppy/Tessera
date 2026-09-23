import type { JsonValue } from '../json';
import { walkDocJSON } from './docjson';
import { headingSlug } from './slug';
import { tagKey } from './tags';
import type { AnyNodeJSON, DocJSON } from './types';

/**
 * Options shared by the extractors. `resolveTitle` supplies the current title of a linked page,
 * used as the text of `pageLink` nodes without a label.
 */
export interface ExtractOptions {
  resolveTitle?: (pageId: string) => string | undefined;
}

/**
 * The display text of inline content: text as is, `hardBreak` as `\n`, `pageLink` as its label (or
 * the resolved title), `tag` as `#name`.
 */
export function inlineText(
  nodes: readonly AnyNodeJSON[] | undefined,
  options: ExtractOptions = {},
): string {
  let text = '';
  for (const node of nodes ?? []) {
    switch (node.type) {
      case 'text':
        text += node.text ?? '';
        break;
      case 'hardBreak':
        text += '\n';
        break;
      case 'pageLink': {
        const pageId = typeof node.attrs?.pageId === 'string' ? node.attrs.pageId : '';
        const label =
          typeof node.attrs?.label === 'string' && node.attrs.label ? node.attrs.label : undefined;
        text += label ?? options.resolveTitle?.(pageId) ?? '';
        break;
      }
      case 'tag':
        text += typeof node.attrs?.name === 'string' ? `#${node.attrs.name}` : '';
        break;
      default:
        break;
    }
  }
  return text;
}

const TEXTBLOCK_TYPES = new Set(['paragraph', 'heading', 'toggleSummary', 'codeBlock']);

/** A block that holds text (paragraph, heading, toggle summary or code block). */
export interface TextBlock {
  /** Child indexes from the doc to the text block. */
  path: number[];
  type: 'paragraph' | 'heading' | 'toggleSummary' | 'codeBlock';
  text: string;
  /** Heading level for headings. */
  level?: 1 | 2 | 3;
  /**
   * Block ID of the text block, or of its nearest container that has one (list item, task, toggle,
   * callout, quote), or null.
   */
  blockId: string | null;
  /** Types of the containers, outermost first (for example `['bulletList', 'listItem']`). */
  containers: string[];
}

/**
 * Every text block in document order, with its display text. The building block of search
 * indexing, backlink context and unlinked mentions.
 */
export function extractTextBlocks(doc: DocJSON, options: ExtractOptions = {}): TextBlock[] {
  const blocks: TextBlock[] = [];
  const containers: AnyNodeJSON[] = [];
  const visit = (node: AnyNodeJSON, path: number[]) => {
    if (TEXTBLOCK_TYPES.has(node.type)) {
      const own = typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : null;
      let blockId = own;
      for (let i = containers.length - 1; i >= 0 && blockId === null; i -= 1) {
        const id = containers[i]?.attrs?.blockId;
        if (typeof id === 'string') blockId = id;
      }
      const block: TextBlock = {
        path,
        type: node.type as TextBlock['type'],
        text: inlineText(node.content, options),
        blockId,
        containers: containers.map((container) => container.type),
      };
      if (node.type === 'heading') {
        const level = node.attrs?.level;
        block.level = level === 2 || level === 3 ? level : 1;
      }
      blocks.push(block);
      return;
    }
    if (path.length > 0) containers.push(node);
    node.content?.forEach((child, index) => visit(child, [...path, index]));
    if (path.length > 0) containers.pop();
  };
  visit(doc as unknown as AnyNodeJSON, []);
  return blocks;
}

/**
 * The document's plain text: every text block's text, one per line (table cells and list items
 * included; images and embeds excluded).
 *
 * @example
 * extractPlainText(doc); // "Launch plan\nShip the beta by Friday"
 */
export function extractPlainText(doc: DocJSON, options: ExtractOptions = {}): string {
  return extractTextBlocks(doc, options)
    .map((block) => block.text)
    .join('\n');
}

/** A heading found by {@link extractHeadings}. */
export interface ExtractedHeading {
  level: 1 | 2 | 3;
  text: string;
  slug: string;
  path: number[];
  blockId: string | null;
}

/** Every heading, in order (the page outline). */
export function extractHeadings(doc: DocJSON, options: ExtractOptions = {}): ExtractedHeading[] {
  return extractTextBlocks(doc, options)
    .filter((block) => block.type === 'heading')
    .map((block) => ({
      level: block.level ?? 1,
      text: block.text,
      slug: headingSlug(block.text),
      path: block.path,
      blockId: block.blockId,
    }));
}

interface InlineHit {
  node: AnyNodeJSON;
  /** Path of the text block. */
  path: number[];
  /** Inline offset (text characters count 1 each, inline atoms 1 each). */
  offset: number;
  block: TextBlock;
}

function inlineHits(doc: DocJSON, type: string, options: ExtractOptions): InlineHit[] {
  const blocks = new Map(
    extractTextBlocks(doc, options).map((block) => [block.path.join('.'), block]),
  );
  const hits: InlineHit[] = [];
  walkDocJSON(doc, (node, path) => {
    if (!TEXTBLOCK_TYPES.has(node.type)) return undefined;
    const block = blocks.get(path.join('.'));
    let offset = 0;
    for (const child of node.content ?? []) {
      if (child.type === type && block) hits.push({ node: child, path: [...path], offset, block });
      offset += child.type === 'text' ? (child.text?.length ?? 0) : 1;
    }
    return false;
  });
  return hits;
}

/** A page link found by {@link extractLinks}. */
export interface ExtractedLink {
  targetPageId: string;
  label: string | null;
  heading: string | null;
  blockRef: string | null;
  /** Display text of the block containing the link (backlink context). */
  blockText: string;
  /** Path of the text block containing the link. */
  path: number[];
  /** Inline offset of the link inside that block. */
  offset: number;
  /** Block ID of the containing block (or its nearest container), or null. */
  blockId: string | null;
}

/**
 * Every `pageLink`, in document order, with the text of its block for backlink context.
 *
 * @example
 * const targets = new Set(extractLinks(doc).map((link) => link.targetPageId));
 */
export function extractLinks(doc: DocJSON, options: ExtractOptions = {}): ExtractedLink[] {
  return inlineHits(doc, 'pageLink', options).flatMap(({ node, path, offset, block }) => {
    const attrs = node.attrs ?? {};
    if (typeof attrs.pageId !== 'string') return [];
    const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
    return [
      {
        targetPageId: attrs.pageId,
        label: str(attrs.label),
        heading: str(attrs.heading),
        blockRef: str(attrs.blockRef),
        blockText: block.text,
        path,
        offset,
        blockId: block.blockId,
      },
    ];
  });
}

/** An inline tag found by {@link extractTags}. */
export interface ExtractedTag {
  /** As written (without `#`). */
  name: string;
  /** Case-insensitive comparison key (`tagKey(name)`). */
  key: string;
  blockText: string;
  path: number[];
  offset: number;
}

/** Every inline `#tag` in document order (page-level tags live in page props). */
export function extractTags(doc: DocJSON, options: ExtractOptions = {}): ExtractedTag[] {
  return inlineHits(doc, 'tag', options).flatMap(({ node, path, offset, block }) => {
    const name = node.attrs?.name;
    if (typeof name !== 'string') return [];
    return [{ name, key: tagKey(name), blockText: block.text, path, offset }];
  });
}

/** A task found by {@link extractTasks}. */
export interface ExtractedTask {
  checked: boolean;
  /** Text of the task's first paragraph. */
  text: string;
  /** Path of the `taskItem`. */
  path: number[];
  blockId: string | null;
  /** 0 for top-level tasks, 1 for subtasks, and so on. */
  depth: number;
}

/** Every task (including subtasks), in document order. */
export function extractTasks(doc: DocJSON, options: ExtractOptions = {}): ExtractedTask[] {
  const tasks: ExtractedTask[] = [];
  const visit = (node: AnyNodeJSON, path: number[], depth: number) => {
    let nextDepth = depth;
    if (node.type === 'taskItem') {
      const first = node.content?.[0];
      tasks.push({
        checked: node.attrs?.checked === true,
        text: first ? inlineText(first.content, options) : '',
        path,
        blockId: typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : null,
        depth,
      });
      nextDepth = depth + 1;
    }
    node.content?.forEach((child, index) => visit(child, [...path, index], nextDepth));
  };
  visit(doc as unknown as AnyNodeJSON, [], 0);
  return tasks;
}

/** An embed found by {@link extractEmbeds}. */
export interface ExtractedEmbed {
  kind: string;
  ref: string | null;
  data: JsonValue | null;
  path: number[];
  blockId: string | null;
}

/** Every `embed` block (databases, web embeds, files, plugin blocks), in document order. */
export function extractEmbeds(doc: DocJSON): ExtractedEmbed[] {
  const embeds: ExtractedEmbed[] = [];
  walkDocJSON(doc, (node, path) => {
    if (node.type !== 'embed' || typeof node.attrs?.kind !== 'string') return undefined;
    embeds.push({
      kind: node.attrs.kind,
      ref: typeof node.attrs.ref === 'string' ? node.attrs.ref : null,
      data: (node.attrs.data ?? null) as JsonValue | null,
      path: [...path],
      blockId: typeof node.attrs.blockId === 'string' ? node.attrs.blockId : null,
    });
    return false;
  });
  return embeds;
}

/** An image found by {@link extractImages}. */
export interface ExtractedImage {
  assetId: string | null;
  src: string | null;
  alt: string | null;
  path: number[];
}

/** Every image, in document order (gallery covers use the first one). */
export function extractImages(doc: DocJSON): ExtractedImage[] {
  const images: ExtractedImage[] = [];
  walkDocJSON(doc, (node, path) => {
    if (node.type !== 'image') return undefined;
    const str = (value: unknown) => (typeof value === 'string' && value ? value : null);
    images.push({
      assetId: str(node.attrs?.assetId),
      src: str(node.attrs?.src),
      alt: str(node.attrs?.alt),
      path: [...path],
    });
    return false;
  });
  return images;
}

/**
 * IDs of every asset the document references (image `assetId`s and `file` embed refs), unique, in
 * document order. Page covers are not content: read them from `PageMeta.cover`.
 */
export function extractAssetIds(doc: DocJSON): string[] {
  const ids = new Set<string>();
  walkDocJSON(doc, (node) => {
    if (node.type === 'image' && typeof node.attrs?.assetId === 'string' && node.attrs.assetId) {
      ids.add(node.attrs.assetId);
    }
    if (
      node.type === 'embed' &&
      node.attrs?.kind === 'file' &&
      typeof node.attrs.ref === 'string' &&
      node.attrs.ref
    ) {
      ids.add(node.attrs.ref);
    }
    return undefined;
  });
  return [...ids];
}
