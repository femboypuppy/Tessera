import type { Node as PMNode } from 'prosemirror-model';
import { isValidBlockId, isValidId } from '../ids';
import { isJsonValue, type JsonValue } from '../json';
import { isValidEmbedKind, MAX_EMBED_DATA_BYTES } from './embeds';
import { tesseraSchema } from './schema';
import { isValidTagName } from './tags';
import { BLOCK_COLORS, CALLOUT_TONES, TEXT_COLORS, type AnyNodeJSON, type DocJSON } from './types';

// ---------------------------------------------------------------------------------------------
// URL safety
// ---------------------------------------------------------------------------------------------

function compactUrl(value: string): string {
  // Browsers ignore ASCII whitespace and control characters inside URLs ("java\tscript:").
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point here
  return value.replace(/[\u0000- \u007f]/g, '');
}

/**
 * True for link targets that are safe to store and render: `http(s):`, `mailto:`, `tel:`,
 * relative paths and `#fragments`. Rejects `javascript:`, `data:`, `vbscript:`, `file:` and every
 * other scheme, including obfuscated ones.
 */
export function isSafeHref(href: unknown): href is string {
  if (typeof href !== 'string' || href.trim() === '' || href.length > 4096) return false;
  const compact = compactUrl(href);
  if (/^(?:https?|mailto|tel):/i.test(compact)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(compact);
}

/**
 * True for image sources that are safe to store: `http(s):` URLs, relative paths (unresolved
 * import paths) and base64 raster `data:` URLs. Prefer `assetId` for local images.
 */
export function isSafeImageSrc(src: unknown): src is string {
  if (typeof src !== 'string' || src.trim() === '' || src.length > 2_000_000) return false;
  const compact = compactUrl(src);
  if (/^https?:/i.test(compact)) return true;
  if (/^data:image\/(?:png|jpe?g|gif|webp|avif);base64,/i.test(compact)) return true;
  return !/^[a-z][a-z0-9+.-]*:/i.test(compact);
}

/** True for `http(s):` URLs (web embeds, bookmark cards). */
export function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 4096) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** An empty document (one empty paragraph). */
export function emptyDocJSON(): DocJSON {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** True when the document has no text and no non-text blocks (only empty paragraphs). */
export function isDocEmpty(doc: DocJSON): boolean {
  return doc.content.every((block) => block.type === 'paragraph' && !block.content?.length);
}

/** A visitor for {@link walkDocJSON}. Return `false` to skip the node's children. */
export type DocVisitor = (
  node: AnyNodeJSON,
  path: readonly number[],
  parent: AnyNodeJSON | null,
) => void | false;

/**
 * Visits every node depth-first in document order. `path` is the list of child indexes from the
 * doc to the node (`[]` for the doc itself).
 *
 * @example
 * walkDocJSON(doc, (node, path) => { if (node.type === 'image') images.push(path); });
 */
export function walkDocJSON(doc: DocJSON | AnyNodeJSON, visitor: DocVisitor): void {
  const visit = (node: AnyNodeJSON, path: number[], parent: AnyNodeJSON | null) => {
    if (visitor(node, path, parent) === false) return;
    node.content?.forEach((child, index) => visit(child, [...path, index], node));
  };
  visit(doc as AnyNodeJSON, [], null);
}

/** Returns the node at `path`, or undefined. */
export function nodeAtPath(
  doc: DocJSON | AnyNodeJSON,
  path: readonly number[],
): AnyNodeJSON | undefined {
  let node: AnyNodeJSON | undefined = doc as AnyNodeJSON;
  for (const index of path) node = node?.content?.[index];
  return node;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/**
 * Structural equality of two documents after normalization (attribute defaults, mark order and
 * key order do not matter).
 */
export function docJSONEqual(a: unknown, b: unknown): boolean {
  return (
    JSON.stringify(sortKeys(normalizeDocJSON(a))) === JSON.stringify(sortKeys(normalizeDocJSON(b)))
  );
}

// ---------------------------------------------------------------------------------------------
// Validation (strict)
// ---------------------------------------------------------------------------------------------

type AttrCheck = (value: unknown) => boolean;

const nullOr =
  (check: AttrCheck): AttrCheck =>
  (value) =>
    value === null || value === undefined || check(value);
const isString =
  (max: number): AttrCheck =>
  (value) =>
    typeof value === 'string' && value.length <= max;
const oneOf =
  (values: readonly unknown[]): AttrCheck =>
  (value) =>
    values.includes(value);
const isInt =
  (min: number, max: number): AttrCheck =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const blockIdCheck = nullOr(isValidBlockId);
const colorCheck = nullOr(oneOf(BLOCK_COLORS));
const LANGUAGE_PATTERN = /^[a-z0-9_+#.-]{1,64}$/i;

/** Attribute validators by node type (every attribute of the schema is listed). */
const NODE_ATTR_CHECKS: Record<string, Record<string, AttrCheck>> = {
  paragraph: { blockId: blockIdCheck, color: colorCheck },
  heading: { level: oneOf([1, 2, 3]), blockId: blockIdCheck, color: colorCheck },
  blockquote: { blockId: blockIdCheck, color: colorCheck },
  callout: { emoji: nullOr(isString(32)), tone: oneOf(CALLOUT_TONES), blockId: blockIdCheck },
  codeBlock: {
    language: nullOr((value) => typeof value === 'string' && LANGUAGE_PATTERN.test(value)),
    blockId: blockIdCheck,
  },
  image: {
    assetId: nullOr(isString(128)),
    src: nullOr(isSafeImageSrc),
    alt: nullOr(isString(2000)),
    title: nullOr(isString(2000)),
    width: nullOr(isInt(10, 100)),
    blockId: blockIdCheck,
  },
  orderedList: { start: isInt(0, 1_000_000) },
  listItem: { blockId: blockIdCheck, color: colorCheck },
  taskItem: {
    checked: (value) => typeof value === 'boolean',
    blockId: blockIdCheck,
    color: colorCheck,
  },
  table: { blockId: blockIdCheck },
  tableHeader: {
    colspan: isInt(1, 1000),
    rowspan: isInt(1, 1000),
    colwidth: nullOr((value) => Array.isArray(value) && value.every((w) => isInt(1, 10_000)(w))),
  },
  tableCell: {
    colspan: isInt(1, 1000),
    rowspan: isInt(1, 1000),
    colwidth: nullOr((value) => Array.isArray(value) && value.every((w) => isInt(1, 10_000)(w))),
  },
  toggle: { open: (value) => typeof value === 'boolean', blockId: blockIdCheck, color: colorCheck },
  embed: {
    kind: isValidEmbedKind,
    ref: nullOr(isString(4096)),
    data: nullOr(
      (value) => isJsonValue(value) && JSON.stringify(value).length <= MAX_EMBED_DATA_BYTES,
    ),
    blockId: blockIdCheck,
  },
  pageLink: {
    pageId: isValidId,
    label: nullOr(isString(2000)),
    heading: nullOr(isString(2000)),
    blockRef: nullOr(isValidBlockId),
  },
  tag: { name: isValidTagName },
};

const MARK_ATTR_CHECKS: Record<string, Record<string, AttrCheck>> = {
  link: { href: isSafeHref, title: nullOr(isString(2000)) },
  highlight: { color: nullOr(oneOf(TEXT_COLORS)) },
};

/** Result of {@link validateDocJSON}. */
export type DocValidation =
  { ok: true; doc: DocJSON; node: PMNode } | { ok: false; errors: string[] };

function describePath(path: readonly number[]): string {
  return path.length ? `doc.${path.map((index) => `content[${index}]`).join('.')}` : 'doc';
}

/**
 * Validates a document strictly against the canonical schema: node and mark names, attribute
 * names and values (safe URLs, valid IDs, colors, tones, levels), unique block IDs, and every
 * content rule. `writeDocJSON` refuses invalid documents; run untrusted input (imports, plugins,
 * pastes) through {@link normalizeDocJSON} first to repair it.
 *
 * @example
 * const result = validateDocJSON(json);
 * if (!result.ok) console.warn(result.errors);
 */
export function validateDocJSON(json: unknown): DocValidation {
  const errors: string[] = [];
  if (!isRecord(json) || json.type !== 'doc')
    return { ok: false, errors: ['The root must be a "doc" node'] };
  const blockIds = new Set<string>();
  const check = (node: unknown, path: number[]) => {
    if (errors.length >= 50) return;
    const where = describePath(path);
    if (!isRecord(node) || typeof node.type !== 'string') {
      errors.push(`${where}: not a node`);
      return;
    }
    const type = tesseraSchema.nodes[node.type];
    if (!type) {
      errors.push(`${where}: unknown node type "${node.type}"`);
      return;
    }
    if (node.type === 'text') {
      if (typeof node.text !== 'string' || node.text.length === 0)
        errors.push(`${where}: text nodes need non-empty text`);
    } else if ('text' in node) {
      errors.push(`${where}: only text nodes have text`);
    }
    const checks = NODE_ATTR_CHECKS[node.type] ?? {};
    const attrs = node.attrs;
    if (attrs !== undefined && !isRecord(attrs)) errors.push(`${where}: attrs must be an object`);
    if (isRecord(attrs)) {
      for (const [name, value] of Object.entries(attrs)) {
        const attrCheck = checks[name];
        if (!attrCheck) errors.push(`${where}: unknown attribute "${name}" on ${node.type}`);
        else if (value !== undefined && !attrCheck(value)) {
          errors.push(
            `${where}: invalid ${node.type}.${name} ${JSON.stringify(value)?.slice(0, 80)}`,
          );
        }
      }
      if (typeof attrs.blockId === 'string') {
        if (blockIds.has(attrs.blockId))
          errors.push(`${where}: duplicate blockId "${attrs.blockId}"`);
        blockIds.add(attrs.blockId);
      }
    }
    for (const [name, attrCheck] of Object.entries(checks)) {
      const spec = (type.spec.attrs as Record<string, { default?: unknown }> | undefined)?.[name];
      const value = isRecord(attrs) ? attrs[name] : undefined;
      if ((value === undefined || value === null) && spec?.default === null && !attrCheck(null)) {
        errors.push(`${where}: ${node.type}.${name} is required`);
      }
    }
    if (node.type === 'image' && isRecord(attrs) && !attrs.assetId && !attrs.src) {
      errors.push(`${where}: images need an assetId or a src`);
    }
    if (node.type === 'embed' && isRecord(attrs) && attrs.kind === 'web' && !isHttpUrl(attrs.ref)) {
      errors.push(`${where}: web embeds need an http(s) URL as ref`);
    }
    if (
      node.marks !== undefined &&
      node.type !== 'text' &&
      Array.isArray(node.marks) &&
      node.marks.length
    ) {
      // y-prosemirror persists marks on text only; marks on atoms would silently disappear.
      errors.push(`${where}: only text nodes can have marks`);
    } else if (node.marks !== undefined) {
      if (!Array.isArray(node.marks)) errors.push(`${where}: marks must be an array`);
      else {
        for (const mark of node.marks) {
          if (!isRecord(mark) || typeof mark.type !== 'string' || !tesseraSchema.marks[mark.type]) {
            errors.push(
              `${where}: unknown mark ${JSON.stringify(isRecord(mark) ? mark.type : mark)}`,
            );
            continue;
          }
          const markChecks = MARK_ATTR_CHECKS[mark.type] ?? {};
          const markAttrs = isRecord(mark.attrs) ? mark.attrs : {};
          for (const [name, value] of Object.entries(markAttrs)) {
            const attrCheck = markChecks[name];
            if (!attrCheck)
              errors.push(`${where}: unknown attribute "${name}" on mark ${mark.type}`);
            else if (value !== undefined && !attrCheck(value))
              errors.push(`${where}: invalid ${mark.type}.${name}`);
          }
          if (mark.type === 'link' && !isSafeHref(markAttrs.href))
            errors.push(`${where}: links need a safe href`);
        }
      }
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) errors.push(`${where}: content must be an array`);
      else node.content.forEach((child, index) => check(child, [...path, index]));
    }
  };
  check(json, []);
  if (errors.length) return { ok: false, errors };
  try {
    const node = tesseraSchema.nodeFromJSON(json);
    node.check();
    return { ok: true, doc: json as unknown as DocJSON, node };
  } catch (error) {
    return { ok: false, errors: [error instanceof Error ? error.message : String(error)] };
  }
}

/** Converts valid DocJSON to a ProseMirror node of the canonical schema (throws when invalid). */
export function docJSONToNode(json: DocJSON): PMNode {
  const result = validateDocJSON(json);
  if (!result.ok) throw new TypeError(`Invalid document: ${result.errors.join('; ')}`);
  return result.node;
}

// ---------------------------------------------------------------------------------------------
// Normalization (tolerant)
// ---------------------------------------------------------------------------------------------

const TEXTBLOCKS = new Set(['paragraph', 'heading', 'toggleSummary']);
const INLINE_TYPES = new Set(['text', 'hardBreak', 'pageLink', 'tag']);
const MARK_RANK = new Map(Object.keys(tesseraSchema.marks).map((name, index) => [name, index]));

function nodeDefaults(type: string): Record<string, unknown> {
  const specAttrs = tesseraSchema.nodes[type]?.spec.attrs as
    Record<string, { default?: unknown }> | undefined;
  return Object.fromEntries(
    Object.entries(specAttrs ?? {}).map(([name, spec]) => [name, spec.default ?? null]),
  );
}

function normalizeAttrs(
  type: string,
  raw: unknown,
  blockIds: Set<string>,
): Record<string, unknown> | undefined {
  const defaults = nodeDefaults(type);
  const names = Object.keys(defaults);
  if (names.length === 0) return undefined;
  const input = isRecord(raw) ? raw : {};
  const checks = NODE_ATTR_CHECKS[type] ?? {};
  const attrs: Record<string, unknown> = {};
  for (const name of names) {
    let value = input[name];
    if (
      type === 'heading' &&
      name === 'level' &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      value = Math.min(3, Math.max(1, Math.round(value)));
    }
    if (
      type === 'image' &&
      name === 'width' &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      value = Math.min(100, Math.max(10, Math.round(value)));
    }
    if (type === 'codeBlock' && name === 'language' && typeof value === 'string') {
      value = value.trim().toLowerCase() || null;
    }
    if (
      (type === 'tableCell' || type === 'tableHeader') &&
      name === 'colwidth' &&
      Array.isArray(value)
    ) {
      value = value.every((w) => isInt(1, 10_000)(w)) ? value : null;
    }
    const valid = value !== undefined && value !== null && (checks[name]?.(value) ?? true);
    attrs[name] = valid ? value : defaults[name];
  }
  if (typeof attrs.blockId === 'string') {
    if (blockIds.has(attrs.blockId)) attrs.blockId = null;
    else blockIds.add(attrs.blockId);
  }
  return attrs;
}

type Mark = { type: string; attrs?: Record<string, unknown> };

function normalizeMarks(raw: unknown): Mark[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const byType = new Map<string, Mark>();
  for (const mark of raw) {
    if (
      !isRecord(mark) ||
      typeof mark.type !== 'string' ||
      !MARK_RANK.has(mark.type) ||
      byType.has(mark.type)
    )
      continue;
    const input = isRecord(mark.attrs) ? mark.attrs : {};
    if (mark.type === 'link') {
      if (!isSafeHref(input.href)) continue;
      byType.set('link', {
        type: 'link',
        attrs: { href: input.href, title: typeof input.title === 'string' ? input.title : null },
      });
    } else if (mark.type === 'highlight') {
      const color = TEXT_COLORS.includes(input.color as never) ? input.color : null;
      byType.set('highlight', { type: 'highlight', attrs: { color } });
    } else {
      byType.set(mark.type, { type: mark.type });
    }
  }
  if (byType.has('code')) return [{ type: 'code' }];
  const marks = [...byType.values()].sort(
    (a, b) => (MARK_RANK.get(a.type) ?? 0) - (MARK_RANK.get(b.type) ?? 0),
  );
  return marks.length ? marks : undefined;
}

function sameMarks(a: Mark[] | undefined, b: Mark[] | undefined): boolean {
  return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
}

/** Plain text of an inline node (for flattening into code blocks). */
function inlineToText(node: AnyNodeJSON): string {
  switch (node.type) {
    case 'text':
      return node.text ?? '';
    case 'hardBreak':
      return '\n';
    case 'pageLink':
      return typeof node.attrs?.label === 'string' ? node.attrs.label : '';
    case 'tag':
      return typeof node.attrs?.name === 'string' ? `#${node.attrs.name}` : '';
    default:
      return (node.content ?? []).map(inlineToText).join('');
  }
}

function mergeText(nodes: AnyNodeJSON[]): AnyNodeJSON[] {
  const result: AnyNodeJSON[] = [];
  for (const node of nodes) {
    const last = result[result.length - 1];
    if (
      node.type === 'text' &&
      last?.type === 'text' &&
      sameMarks(last.marks as Mark[], node.marks as Mark[])
    ) {
      result[result.length - 1] = { ...last, text: `${last.text ?? ''}${node.text ?? ''}` };
    } else {
      result.push(node);
    }
  }
  return result;
}

/** Turns any normalized nodes into inline content (blocks are flattened, separated by hard breaks). */
function toInline(nodes: AnyNodeJSON[]): AnyNodeJSON[] {
  const result: AnyNodeJSON[] = [];
  for (const node of nodes) {
    if (INLINE_TYPES.has(node.type)) {
      result.push(node);
      continue;
    }
    const inner = toInline(node.content ?? []);
    if (inner.length === 0) continue;
    if (result.length > 0 && result[result.length - 1]?.type !== 'hardBreak')
      result.push({ type: 'hardBreak' });
    result.push(...inner);
  }
  return mergeText(result);
}

function paragraph(content: AnyNodeJSON[] = [], attrs?: Record<string, unknown>): AnyNodeJSON {
  const node: AnyNodeJSON = { type: 'paragraph', attrs: attrs ?? { blockId: null, color: null } };
  const inline = mergeText(content);
  if (inline.length) node.content = inline;
  return node;
}

/** Converts normalized nodes into a valid list of blocks (inline runs become paragraphs). */
function toBlocks(nodes: AnyNodeJSON[]): AnyNodeJSON[] {
  const result: AnyNodeJSON[] = [];
  let inlineRun: AnyNodeJSON[] = [];
  const flush = () => {
    if (inlineRun.length) result.push(paragraph(inlineRun));
    inlineRun = [];
  };
  for (const node of nodes) {
    if (INLINE_TYPES.has(node.type)) {
      inlineRun.push(node);
      continue;
    }
    flush();
    const groups = tesseraSchema.nodes[node.type]?.spec.group ?? '';
    if (groups.split(' ').includes('block')) result.push(node);
    else if (node.type === 'toggleSummary') result.push(paragraph(node.content ?? []));
    else if (
      node.type === 'listItem' ||
      node.type === 'taskItem' ||
      node.type === 'tableCell' ||
      node.type === 'tableHeader'
    ) {
      result.push(...toBlocks(node.content ?? []));
    } else if (node.type === 'tableRow') {
      for (const cell of node.content ?? []) result.push(...toBlocks(cell.content ?? []));
    }
  }
  flush();
  return result;
}

/** Converts blocks into paragraphs only (table cells), keeping every textblock's text. */
function toParagraphs(nodes: AnyNodeJSON[]): AnyNodeJSON[] {
  const result: AnyNodeJSON[] = [];
  for (const node of toBlocks(nodes)) {
    if (node.type === 'paragraph') result.push(node);
    else if (TEXTBLOCKS.has(node.type) || node.type === 'codeBlock') {
      result.push(paragraph(node.type === 'codeBlock' ? textOf(node) : (node.content ?? [])));
    } else if (node.content?.length) result.push(...toParagraphs(node.content));
  }
  return result;
}

function textOf(node: AnyNodeJSON): AnyNodeJSON[] {
  const text = (node.content ?? []).map(inlineToText).join('');
  return text ? [{ type: 'text', text }] : [];
}

/** Re-types already normalized attributes (keeps shared keys, fills the rest with defaults). */
function convertAttrs(
  attrs: Record<string, unknown> | undefined,
  toType: string,
): Record<string, unknown> | undefined {
  const defaults = nodeDefaults(toType);
  if (Object.keys(defaults).length === 0) return undefined;
  const result: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    if (attrs && attrs[key] !== undefined) result[key] = attrs[key];
  }
  return result;
}

function listItemFrom(
  node: AnyNodeJSON,
  itemType: 'listItem' | 'taskItem',
  blockIds: Set<string>,
): AnyNodeJSON {
  if (node.type === 'listItem' || node.type === 'taskItem') {
    return {
      type: itemType,
      attrs: convertAttrs(node.attrs, itemType),
      content: itemContent(node.content ?? []),
    };
  }
  return {
    type: itemType,
    attrs: normalizeAttrs(itemType, undefined, blockIds),
    content: itemContent([node]),
  };
}

function itemContent(blocks: AnyNodeJSON[]): AnyNodeJSON[] {
  const content = toBlocks(blocks);
  const first = content[0];
  if (!first) return [paragraph()];
  if (first.type === 'paragraph') return content;
  if (TEXTBLOCKS.has(first.type)) return [paragraph(first.content ?? []), ...content.slice(1)];
  return [paragraph(), ...content];
}

function normalizeNode(raw: unknown, blockIds: Set<string>, depth: number): AnyNodeJSON[] {
  if (!isRecord(raw) || typeof raw.type !== 'string' || depth > 200) return [];
  const rawContent = Array.isArray(raw.content) ? raw.content : [];
  const children = () => rawContent.flatMap((child) => normalizeNode(child, blockIds, depth + 1));
  const type = raw.type;

  if (type === 'text') {
    if (typeof raw.text !== 'string' || raw.text.length === 0) return [];
    const node: AnyNodeJSON = { type: 'text', text: raw.text };
    const marks = normalizeMarks(raw.marks);
    if (marks) node.marks = marks;
    return [node];
  }
  if (!tesseraSchema.nodes[type] || type === 'doc') return children();

  const attrs = normalizeAttrs(type, raw.attrs, blockIds);
  const withAttrs = (node: AnyNodeJSON): AnyNodeJSON => (attrs ? { ...node, attrs } : node);

  switch (type) {
    case 'hardBreak':
    case 'horizontalRule':
      return [{ type }];
    case 'pageLink':
      if (!attrs || !isValidId(attrs.pageId)) {
        const label =
          isRecord(raw.attrs) && typeof raw.attrs.label === 'string' ? raw.attrs.label : '';
        return label ? [{ type: 'text', text: label }] : [];
      }
      return [withAttrs({ type })];
    case 'tag':
      if (!attrs || !isValidTagName(attrs.name)) {
        const name =
          isRecord(raw.attrs) && typeof raw.attrs.name === 'string' ? raw.attrs.name : '';
        return name ? [{ type: 'text', text: `#${name}` }] : [];
      }
      return [withAttrs({ type })];
    case 'image':
      if (!attrs?.assetId && !attrs?.src) return [];
      return [withAttrs({ type })];
    case 'embed':
      if (!attrs || !isValidEmbedKind(attrs.kind)) return [];
      return [withAttrs({ type })];
    case 'paragraph':
    case 'heading':
    case 'toggleSummary': {
      const node = withAttrs({ type });
      const inline = toInline(children());
      if (inline.length) node.content = inline;
      return [node];
    }
    case 'codeBlock': {
      const node = withAttrs({ type });
      const text = children().map(inlineToText).join('');
      if (text) node.content = [{ type: 'text', text }];
      return [node];
    }
    case 'blockquote':
    case 'callout': {
      const content = toBlocks(children());
      return [withAttrs({ type, content: content.length ? content : [paragraph()] })];
    }
    case 'listItem':
    case 'taskItem':
      return [withAttrs({ type, content: itemContent(children()) })];
    case 'bulletList':
    case 'orderedList':
    case 'taskList': {
      const itemType = type === 'taskList' ? 'taskItem' : 'listItem';
      const items: AnyNodeJSON[] = [];
      let run: AnyNodeJSON[] = [];
      const flushRun = () => {
        if (run.length) items.push(listItemFrom(paragraph(run), itemType, blockIds));
        run = [];
      };
      for (const child of children()) {
        if (INLINE_TYPES.has(child.type)) {
          run.push(child);
          continue;
        }
        flushRun();
        items.push(listItemFrom(child, itemType, blockIds));
      }
      flushRun();
      if (items.length === 0) {
        items.push({
          type: itemType,
          attrs: normalizeAttrs(itemType, {}, blockIds),
          content: [paragraph()],
        });
      }
      return [withAttrs({ type, content: items })];
    }
    case 'table': {
      const rows = children().map((child): AnyNodeJSON => {
        if (child.type === 'tableRow') return child;
        return {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: normalizeAttrs('tableCell', {}, blockIds),
              content: toParagraphs([child]),
            },
          ],
        };
      });
      return [
        withAttrs({
          type,
          content: rows.length
            ? rows
            : [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableCell',
                      attrs: normalizeAttrs('tableCell', {}, blockIds),
                      content: [paragraph()],
                    },
                  ],
                },
              ],
        }),
      ];
    }
    case 'tableRow': {
      const cells = children().map((child): AnyNodeJSON => {
        if (child.type === 'tableCell' || child.type === 'tableHeader') return child;
        return {
          type: 'tableCell',
          attrs: normalizeAttrs('tableCell', {}, blockIds),
          content: toParagraphs([child]),
        };
      });
      const node: AnyNodeJSON = { type };
      if (cells.length) node.content = cells;
      return [node];
    }
    case 'tableCell':
    case 'tableHeader': {
      const content = toParagraphs(children());
      return [withAttrs({ type, content: content.length ? content : [paragraph()] })];
    }
    case 'toggle': {
      const content = children();
      const first = content[0];
      let summary: AnyNodeJSON;
      let rest: AnyNodeJSON[];
      if (first?.type === 'toggleSummary') {
        summary = first;
        rest = content.slice(1);
      } else if (first && TEXTBLOCKS.has(first.type)) {
        summary = {
          type: 'toggleSummary',
          ...(first.content?.length ? { content: first.content } : {}),
        };
        rest = content.slice(1);
      } else {
        summary = { type: 'toggleSummary' };
        rest = content;
      }
      return [withAttrs({ type, content: [summary, ...toBlocks(rest)] })];
    }
    default:
      return children();
  }
}

/**
 * Repairs any JSON into a valid document of the canonical schema, keeping as much content as
 * possible: unknown nodes are unwrapped, unknown attributes and marks dropped, unsafe links and
 * image sources removed (their text is kept), missing required content filled in, blocks inside
 * text flattened, duplicate block IDs cleared, adjacent text merged and marks put in schema order.
 * Every attribute is present in the output. `readDocJSON` returns normalized documents.
 *
 * @example
 * writeDocJSON(pageDoc, normalizeDocJSON(parsedFromSomewhere));
 */
export function normalizeDocJSON(input: unknown): DocJSON {
  const blockIds = new Set<string>();
  const content =
    isRecord(input) && Array.isArray(input.content)
      ? toBlocks(input.content.flatMap((child) => normalizeNode(child, blockIds, 0)))
      : [];
  const doc = {
    type: 'doc',
    content: content.length ? content : [paragraph()],
  } as unknown as DocJSON;
  const result = validateDocJSON(doc);
  if (result.ok) return doc;
  // Last resort (should not happen): keep every piece of text as plain paragraphs.
  const texts: string[] = [];
  walkDocJSON(doc, (node) => {
    if (TEXTBLOCKS.has(node.type) || node.type === 'codeBlock') {
      const text = (node.content ?? []).map(inlineToText).join('');
      if (text) texts.push(text);
      return false;
    }
    return undefined;
  });
  return {
    type: 'doc',
    content: texts.length
      ? texts.map((text) => ({
          type: 'paragraph',
          attrs: { blockId: null, color: null },
          content: [{ type: 'text', text }],
        }))
      : [{ type: 'paragraph', attrs: { blockId: null, color: null } }],
  };
}

/** Type guard for values that are JSON objects shaped like a document root. */
export function isDocJSON(value: unknown): value is DocJSON {
  return validateDocJSON(value).ok;
}

/** @internal JSON values allowed in `embed.data`. */
export type EmbedData = JsonValue;
