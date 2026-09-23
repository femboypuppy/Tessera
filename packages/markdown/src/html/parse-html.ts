import {
  BLOCK_COLORS,
  TEXT_COLORS,
  isHttpUrl,
  isSafeHref,
  isSafeImageSrc,
  isValidBlockId,
  type AnyNodeJSON,
} from '@tessera/core';
import DOMPurify from 'dompurify';
import { CALLOUT_TYPES } from '../callouts';
import { isEmbeddableUrl } from '../embeds';
import { htmlToBlocksStandalone } from '../to-doc';

type Mark = { type: string; attrs?: Record<string, unknown> };
type Item = { kind: 'inline'; node: AnyNodeJSON } | { kind: 'block'; node: AnyNodeJSON };

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

const CONTAINER_TAGS = new Set([
  'div',
  'section',
  'article',
  'main',
  'header',
  'footer',
  'nav',
  'center',
  'address',
  'body',
  'html',
  'form',
  'fieldset',
  'hgroup',
  'dl',
  'tbody',
  'thead',
  'tfoot',
]);
const PARAGRAPH_TAGS = new Set(['p', 'dt', 'dd', 'figcaption', 'caption', 'legend']);
const BLOCK_TAGS = new Set([
  ...CONTAINER_TAGS,
  ...PARAGRAPH_TAGS,
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'pre',
  'ul',
  'ol',
  'li',
  'table',
  'tr',
  'hr',
  'details',
  'summary',
  'figure',
  'aside',
]);
const MONOSPACE = /(monospace|courier|consolas|menlo|monaco|source code|fira code|jetbrains mono)/i;
const LANGUAGE_PATTERN = /^[a-z0-9_+#.-]{1,64}$/;

function tagName(element: Element): string {
  return element.tagName.toLowerCase();
}

function styleOf(element: Element): string {
  return (element.getAttribute('style') ?? '').toLowerCase().replace(/\s+/g, '');
}

function classes(element: Element): string[] {
  return (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
}

/** Notion colors (`block-color-red`, `highlight-blue_background`) and `data-color` attributes. */
function colorFrom(element: Element, prefix: 'block-color-' | 'highlight-'): string | null {
  const data = element.getAttribute('data-color');
  if (data && (BLOCK_COLORS as readonly string[]).includes(data)) return data;
  for (const name of classes(element)) {
    if (!name.startsWith(prefix)) continue;
    const color = name.slice(prefix.length).replace('_background', '-background');
    if ((BLOCK_COLORS as readonly string[]).includes(color)) return color;
  }
  return null;
}

function isHidden(element: Element): boolean {
  const style = styleOf(element);
  return (
    style.includes('display:none') ||
    style.includes('visibility:hidden') ||
    style.includes('mso-list:ignore') ||
    element.getAttribute('aria-hidden') === 'true'
  );
}

function marksFromStyle(element: Element): { add: Mark[]; removeBold: boolean } {
  const style = styleOf(element);
  const add: Mark[] = [];
  const weight = /font-weight:(\w+)/.exec(style)?.[1];
  if (weight === 'bold' || weight === 'bolder' || (weight && Number(weight) >= 600))
    add.push({ type: 'bold' });
  if (style.includes('font-style:italic')) add.push({ type: 'italic' });
  if (/text-decoration[^;]*underline/.test(style)) add.push({ type: 'underline' });
  if (/text-decoration[^;]*line-through/.test(style)) add.push({ type: 'strike' });
  const family = /font-family:([^;]+)/.exec(style)?.[1];
  if (family && MONOSPACE.test(family)) add.push({ type: 'code' });
  const removeBold = weight === 'normal' || weight === '400' || weight === 'lighter';
  return { add, removeBold };
}

function text(value: string, marks: readonly Mark[]): AnyNodeJSON {
  return marks.length
    ? { type: 'text', text: value, marks: [...marks] }
    : { type: 'text', text: value };
}

function isBlank(node: AnyNodeJSON): boolean {
  return node.type === 'text' && !(node.text ?? '').trim();
}

/** Trims collapsed whitespace at the edges of a line of inline content. */
function trimInline(content: AnyNodeJSON[]): AnyNodeJSON[] {
  const result = [...content];
  while (result.length && isBlank(result[0] as AnyNodeJSON)) result.shift();
  while (result.length && isBlank(result[result.length - 1] as AnyNodeJSON)) result.pop();
  const first = result[0];
  if (first?.type === 'text')
    result[0] = { ...first, text: (first.text ?? '').replace(/^\s+/, '') };
  const last = result[result.length - 1];
  if (last?.type === 'text')
    result[result.length - 1] = { ...last, text: (last.text ?? '').replace(/\s+$/, '') };
  // Trailing hard breaks (`<br>` before a block end) add nothing.
  while (result[result.length - 1]?.type === 'hardBreak') result.pop();
  return result.filter((node) => node.type !== 'text' || node.text);
}

class HtmlToDoc {
  /** Converts the children of a node into blocks. */
  blocks(parent: Node): AnyNodeJSON[] {
    const out: AnyNodeJSON[] = [];
    let run: Item[] = [];
    const flush = () => {
      out.push(...this.itemsToBlocks(run, (content) => ({ type: 'paragraph', content })));
      run = [];
    };
    const children = [...parent.childNodes];
    for (let index = 0; index < children.length; index += 1) {
      const child = children[index] as Node;
      if (child.nodeType === ELEMENT_NODE) {
        const element = child as Element;
        const name = tagName(element);
        if (isHidden(element)) continue;
        if (this.isWordListParagraph(element)) {
          flush();
          const group: Element[] = [];
          while (index < children.length) {
            const candidate = children[index] as Node;
            if (candidate.nodeType === TEXT_NODE && !(candidate.textContent ?? '').trim()) {
              index += 1;
              continue;
            }
            if (
              candidate.nodeType !== ELEMENT_NODE ||
              !this.isWordListParagraph(candidate as Element)
            )
              break;
            group.push(candidate as Element);
            index += 1;
          }
          index -= 1;
          out.push(...this.wordList(group));
          continue;
        }
        if (BLOCK_TAGS.has(name)) {
          flush();
          out.push(...this.block(element));
          continue;
        }
      }
      this.inline(child, [], run);
    }
    flush();
    return out;
  }

  private itemsToBlocks(
    items: Item[],
    makeBlock: (content: AnyNodeJSON[]) => AnyNodeJSON,
  ): AnyNodeJSON[] {
    const out: AnyNodeJSON[] = [];
    let run: AnyNodeJSON[] = [];
    const flush = () => {
      const content = trimInline(run);
      if (content.length) out.push(makeBlock(content));
      run = [];
    };
    for (const item of items) {
      if (item.kind === 'inline') run.push(item.node);
      else {
        flush();
        out.push(item.node);
      }
    }
    flush();
    return out;
  }

  private textblock(element: Element, type: 'paragraph' | 'heading', level = 1): AnyNodeJSON[] {
    const items: Item[] = [];
    for (const child of element.childNodes) this.inline(child, [], items);
    const color = colorFrom(element, 'block-color-');
    const blocks = this.itemsToBlocks(items, (content) => {
      const node: AnyNodeJSON = { type, content };
      const attrs: Record<string, unknown> = {};
      if (type === 'heading') attrs.level = level;
      if (color) attrs.color = color;
      if (Object.keys(attrs).length) node.attrs = attrs;
      return node;
    });
    return blocks;
  }

  private block(element: Element): AnyNodeJSON[] {
    const name = tagName(element);
    if (/^h[1-6]$/.test(name))
      return this.textblock(element, 'heading', Math.min(3, Number(name[1])));
    if (PARAGRAPH_TAGS.has(name)) {
      // Malformed HTML puts blocks inside paragraphs.
      if ([...element.children].some((child) => BLOCK_TAGS.has(tagName(child))))
        return this.blocks(element);
      return this.textblock(element, 'paragraph');
    }
    switch (name) {
      case 'blockquote': {
        const content = this.blocks(element);
        return [{ type: 'blockquote', content }];
      }
      case 'aside':
      case 'figure':
        if (name === 'aside' || classes(element).includes('callout'))
          return [this.callout(element)];
        return this.blocks(element);
      case 'pre':
        return [this.codeBlock(element)];
      case 'ul':
      case 'ol':
        return this.list(element);
      case 'li':
        return this.list(element.ownerDocument.createElement('ul'), [element]);
      case 'table':
        return [this.table(element)];
      case 'tr':
        return this.blocks(element);
      case 'hr':
        return [{ type: 'horizontalRule' }];
      case 'details':
        return [this.toggle(element)];
      case 'summary':
        return this.textblock(element, 'paragraph');
      default:
        return this.blocks(element);
    }
  }

  private callout(element: Element): AnyNodeJSON {
    const icon = element.querySelector('.icon');
    const emoji = icon?.textContent?.trim() || null;
    icon?.remove();
    const tone =
      CALLOUT_TYPES.find((entry) => entry.emoji === emoji)?.tone ??
      (classes(element).some((name) => name.includes('warning')) ? 'warning' : 'default');
    const attrs: Record<string, unknown> = { tone };
    if (emoji && emoji.length <= 32) attrs.emoji = emoji;
    return { type: 'callout', attrs, content: this.blocks(element) };
  }

  private codeBlock(element: Element): AnyNodeJSON {
    const code = element.querySelector('code');
    const source = code ?? element;
    const languageClass = [...classes(source), ...classes(element)].find((name) =>
      /^(language|lang)-/.test(name),
    );
    const raw = (
      element.getAttribute('data-language') ??
      languageClass?.replace(/^(language|lang)-/, '') ??
      ''
    )
      .trim()
      .toLowerCase();
    const language = LANGUAGE_PATTERN.test(raw) && raw !== 'plain' && raw !== 'text' ? raw : null;
    const value = this.preText(source).replace(/\n$/, '');
    const node: AnyNodeJSON = { type: 'codeBlock', attrs: { language } };
    if (value) node.content = [{ type: 'text', text: value }];
    return node;
  }

  /** Text of a `<pre>`, with `<br>` as line breaks and block children on their own lines. */
  private preText(node: Node): string {
    let result = '';
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) result += child.textContent ?? '';
      else if (child.nodeType === ELEMENT_NODE) {
        const name = tagName(child as Element);
        if (name === 'br') result += '\n';
        else {
          const inner = this.preText(child);
          result += name === 'div' || name === 'p' ? `${inner}\n` : inner;
        }
      }
    }
    return result;
  }

  private taskState(li: Element): boolean | null {
    const role = li.getAttribute('role');
    const aria = li.getAttribute('aria-checked');
    if (role === 'checkbox' || aria === 'true' || aria === 'false') return aria === 'true';
    const checkbox = li.querySelector(
      ':scope > input[type="checkbox"], :scope > p > input[type="checkbox"], :scope > label > input[type="checkbox"]',
    );
    if (checkbox) return checkbox.hasAttribute('checked');
    const notion = li.querySelector(':scope > .checkbox');
    if (notion) return classes(notion).includes('checkbox-on');
    return null;
  }

  private list(element: Element, items?: Element[]): AnyNodeJSON[] {
    const ordered = tagName(element) === 'ol';
    const listItems = items ?? [...element.children].filter((child) => tagName(child) === 'li');
    const startAttr = Number(element.getAttribute('start'));
    const start = Number.isInteger(startAttr) && startAttr >= 0 ? startAttr : 1;
    const forceTask = classes(element).some(
      (name) => name === 'to-do-list' || name === 'contains-task-list',
    );
    const lists: AnyNodeJSON[] = [];
    let current: { task: boolean; node: AnyNodeJSON } | null = null;
    listItems.forEach((li, index) => {
      const state = this.taskState(li);
      const task = state !== null || forceTask;
      if (!current || current.task !== task) {
        const node: AnyNodeJSON = {
          type: task ? 'taskList' : ordered ? 'orderedList' : 'bulletList',
          content: [],
        };
        if (!task && ordered) node.attrs = { start: start + index };
        lists.push(node);
        current = { task, node };
      }
      const clone = li.cloneNode(true) as Element;
      clone.querySelectorAll('input[type="checkbox"], .checkbox').forEach((box) => box.remove());
      const content = this.blocks(clone);
      const attrs: Record<string, unknown> = {};
      if (task) attrs.checked = state === true;
      const color = colorFrom(li, 'block-color-');
      if (color) attrs.color = color;
      current.node.content?.push({ type: task ? 'taskItem' : 'listItem', attrs, content });
    });
    return lists;
  }

  private isWordListParagraph(element: Element): boolean {
    return tagName(element) === 'p' && /mso-list:l\d+level\d+/.test(styleOf(element));
  }

  /** Word puts list items in paragraphs (`mso-list: l0 level2`) with a hidden marker span. */
  private wordList(paragraphs: Element[]): AnyNodeJSON[] {
    const root: AnyNodeJSON[] = [];
    const stack: Array<{ level: number; list: AnyNodeJSON }> = [];
    for (const paragraph of paragraphs) {
      const level = Number(/level(\d+)/.exec(styleOf(paragraph))?.[1] ?? 1);
      const marker = paragraph.querySelector('[style*="mso-list"]')?.textContent?.trim() ?? '';
      const ordered = /^[0-9a-z]{1,3}[.)]$/i.test(marker);
      const content = this.textblock(paragraph, 'paragraph');
      const item: AnyNodeJSON = {
        type: 'listItem',
        content: content.length ? content : [{ type: 'paragraph' }],
      };
      while (stack.length && (stack[stack.length - 1] as { level: number }).level > level)
        stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const list: AnyNodeJSON = { type: ordered ? 'orderedList' : 'bulletList', content: [] };
        if (top) {
          const parentItem = top.list.content?.[top.list.content.length - 1];
          if (parentItem) parentItem.content = [...(parentItem.content ?? []), list];
          else top.list.content?.push({ type: 'listItem', content: [{ type: 'paragraph' }, list] });
        } else {
          root.push(list);
        }
        top = { level, list };
        stack.push(top);
      }
      top.list.content?.push(item);
    }
    return root;
  }

  private table(element: Element): AnyNodeJSON {
    const rows = [...element.querySelectorAll('tr')].filter(
      (row) => row.closest('table') === element,
    );
    return {
      type: 'table',
      content: rows.map((row, rowIndex) => ({
        type: 'tableRow',
        content: [...row.children]
          .filter((cell) => tagName(cell) === 'td' || tagName(cell) === 'th')
          .map((cell) => {
            const items: Item[] = [];
            for (const child of cell.childNodes) this.cellInline(child, items);
            const paragraphs: AnyNodeJSON[] = [];
            let run: AnyNodeJSON[] = [];
            const flush = () => {
              paragraphs.push({ type: 'paragraph', content: trimInline(run) });
              run = [];
            };
            for (const item of items) {
              if (item.kind === 'block') flush();
              else run.push(item.node);
            }
            flush();
            const header = tagName(cell) === 'th' && rowIndex === 0;
            const colspan = Number(cell.getAttribute('colspan'));
            const node: AnyNodeJSON = {
              type: header ? 'tableHeader' : 'tableCell',
              content: paragraphs.filter(
                (paragraph, index) => index === 0 || paragraph.content?.length,
              ),
            };
            if (Number.isInteger(colspan) && colspan > 1) node.attrs = { colspan };
            return node;
          }),
      })),
    };
  }

  /** Cells hold paragraphs only: block children become paragraph breaks. */
  private cellInline(node: Node, items: Item[]): void {
    if (node.nodeType === ELEMENT_NODE && BLOCK_TAGS.has(tagName(node as Element))) {
      items.push({ kind: 'block', node: { type: 'paragraph' } });
      for (const child of node.childNodes) this.cellInline(child, items);
      items.push({ kind: 'block', node: { type: 'paragraph' } });
      return;
    }
    const before = items.length;
    this.inline(node, [], items);
    // Images in cells keep only their text.
    for (let index = before; index < items.length; index += 1) {
      const item = items[index] as Item;
      if (item.kind === 'block') {
        const alt = item.node.attrs?.alt;
        items[index] = { kind: 'inline', node: text(typeof alt === 'string' ? alt : '', []) };
      }
    }
  }

  private toggle(element: Element): AnyNodeJSON {
    const summaryElement = [...element.children].find((child) => tagName(child) === 'summary');
    const summaryItems: Item[] = [];
    if (summaryElement)
      for (const child of summaryElement.childNodes) this.inline(child, [], summaryItems);
    const clone = element.cloneNode(true) as Element;
    [...clone.children].find((child) => tagName(child) === 'summary')?.remove();
    const summary: AnyNodeJSON = {
      type: 'toggleSummary',
      content: trimInline(
        summaryItems.filter((item) => item.kind === 'inline').map((item) => item.node),
      ),
    };
    const attrs: Record<string, unknown> = { open: element.hasAttribute('open') };
    const color = colorFrom(element, 'block-color-');
    if (color) attrs.color = color;
    const blockId = element.getAttribute('data-block-id');
    if (isValidBlockId(blockId)) attrs.blockId = blockId;
    return { type: 'toggle', attrs, content: [summary, ...this.blocks(clone)] };
  }

  private image(element: Element): AnyNodeJSON | null {
    const src = element.getAttribute('src') ?? '';
    const alt = element.getAttribute('alt');
    const title = element.getAttribute('title');
    if (isEmbeddableUrl(src))
      return { type: 'embed', attrs: { kind: 'web', ref: src, data: { display: 'embed' } } };
    if (!src || !(isHttpUrl(src) || /^data:image\//i.test(src)) || !isSafeImageSrc(src))
      return null;
    return { type: 'image', attrs: { src, alt: alt || null, title: title || null } };
  }

  /** Converts inline content, pushing text, atoms and image breakouts into `items`. */
  inline(node: Node, marks: readonly Mark[], items: Item[]): void {
    if (node.nodeType === TEXT_NODE) {
      const value = (node.textContent ?? '').replace(/[\s\u200b]+/g, (match) =>
        match.includes('\u00a0') ? '\u00a0' : ' ',
      );
      if (value) items.push({ kind: 'inline', node: text(value, marks) });
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;
    const element = node as Element;
    if (isHidden(element)) return;
    const name = tagName(element);
    if (name === 'br') {
      items.push({ kind: 'inline', node: { type: 'hardBreak' } });
      return;
    }
    if (name === 'img') {
      const image = this.image(element);
      if (image) items.push({ kind: 'block', node: image });
      else {
        const alt = element.getAttribute('alt');
        if (alt) items.push({ kind: 'inline', node: text(alt, marks) });
      }
      return;
    }
    if (name === 'input') return;
    if (BLOCK_TAGS.has(name)) {
      // A block inside inline content (a list in a paragraph, a div in a span): keep the text.
      for (const block of this.block(element)) items.push({ kind: 'block', node: block });
      return;
    }
    let next = [...marks];
    const { add, removeBold } = marksFromStyle(element);
    if (removeBold) next = next.filter((mark) => mark.type !== 'bold');
    switch (name) {
      case 'b':
      case 'strong':
        if (!removeBold) next.push({ type: 'bold' });
        break;
      case 'i':
      case 'em':
      case 'cite':
      case 'dfn':
        next.push({ type: 'italic' });
        break;
      case 'u':
      case 'ins':
        next.push({ type: 'underline' });
        break;
      case 's':
      case 'strike':
      case 'del':
        next.push({ type: 'strike' });
        break;
      case 'code':
      case 'kbd':
      case 'samp':
      case 'tt':
        next.push({ type: 'code' });
        break;
      case 'mark': {
        const color = colorFrom(element, 'highlight-')?.replace('-background', '') ?? null;
        next.push({
          type: 'highlight',
          attrs: {
            color: color && (TEXT_COLORS as readonly string[]).includes(color) ? color : null,
          },
        });
        break;
      }
      case 'a': {
        const href = element.getAttribute('href');
        if (href && isSafeHref(href) && !href.startsWith('#')) {
          next = next.filter((mark) => mark.type !== 'link');
          next.push({ type: 'link', attrs: { href, title: element.getAttribute('title') } });
        }
        break;
      }
      default:
    }
    next.push(...add);
    for (const child of element.childNodes) this.inline(child, next, items);
  }
}

function hasDom(): boolean {
  return typeof window !== 'undefined' && typeof DOMParser !== 'undefined' && DOMPurify.isSupported;
}

/**
 * Converts HTML (clipboard, imports) into a document. With a DOM, the HTML is sanitized by
 * DOMPurify first and walked as a DOM; without one (workers, servers) the whitelist tokenizer
 * keeps text, headings and inline formatting.
 */
export function parseHtmlToDoc(html: string): AnyNodeJSON {
  if (!hasDom()) return { type: 'doc', content: htmlToBlocksStandalone(html) };
  const fragment = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: [
      'style',
      'script',
      'template',
      'form',
      'button',
      'select',
      'textarea',
      'option',
      'iframe',
    ],
    ADD_ATTR: ['checked', 'aria-checked', 'role', 'start', 'open'],
    ALLOW_DATA_ATTR: true,
  });
  return { type: 'doc', content: new HtmlToDoc().blocks(fragment) };
}
