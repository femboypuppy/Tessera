import type * as Y from 'yjs';
import { isJsonValue, type JsonValue } from '../json';

/** Top-level shared types of a page doc (`page:<pageId>`). */
export const PAGE_DOC_KEYS = {
  /** `Y.XmlFragment` holding the ProseMirror document (canonical schema from `@tessera/core`). */
  content: 'content',
  /** `Y.Map<key, JsonValue>` of page-level properties. */
  props: 'props',
} as const;

/**
 * Page-level properties stored in the page doc. Well-known keys are typed; imported frontmatter
 * keys are stored alongside them unchanged, so exports can write them back.
 */
export interface PageProps {
  /** Page tags (from frontmatter `tags`), without `#`. Inline `#tags` live in the content. */
  tags?: string[];
  /** Alternative titles, used for link resolution and unlinked mentions. */
  aliases?: string[];
  /** Display: use the full page width. */
  fullWidth?: boolean;
  /** Display: smaller body text. */
  smallText?: boolean;
  [key: string]: JsonValue | undefined;
}

/** Keys of {@link PageProps} with a defined meaning. Everything else is imported frontmatter. */
export const WELL_KNOWN_PAGE_PROPS = ['tags', 'aliases', 'fullWidth', 'smallText'] as const;

/**
 * Returns the `Y.XmlFragment` that holds a page's content. Only the editor binds to it directly
 * (TipTap `Collaboration` with `fragment: getPageContent(doc)` or `field: 'content'`); everyone else
 * reads and writes content through `readDocJSON` / `writeDocJSON`.
 */
export function getPageContent(doc: Y.Doc): Y.XmlFragment {
  return doc.getXmlFragment(PAGE_DOC_KEYS.content);
}

function propsMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(PAGE_DOC_KEYS.props);
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return list;
}

/**
 * Reads all page props. Malformed well-known props are dropped from the result (never thrown).
 *
 * @example
 * const { tags = [], aliases = [] } = getPageProps(pageDoc);
 */
export function getPageProps(doc: Y.Doc): PageProps {
  const props: PageProps = {};
  propsMap(doc).forEach((value, key) => {
    if (!isJsonValue(value)) return;
    if (key === 'tags' || key === 'aliases') {
      const list = stringList(value);
      if (list) props[key] = list;
    } else if (key === 'fullWidth' || key === 'smallText') {
      if (typeof value === 'boolean') props[key] = value;
    } else {
      props[key] = value;
    }
  });
  return props;
}

/** Reads one page prop. */
export function getPageProp(doc: Y.Doc, key: string): JsonValue | undefined {
  return getPageProps(doc)[key];
}

/**
 * Writes (or, with `undefined`, deletes) a page prop.
 *
 * @example
 * setPageProp(pageDoc, 'aliases', ['Q3 plan']);
 */
export function setPageProp(
  doc: Y.Doc,
  key: string,
  value: JsonValue | undefined,
  options: { origin?: unknown } = {},
): void {
  if (value !== undefined && !isJsonValue(value))
    throw new TypeError(`Page prop "${key}" must be a JSON value`);
  doc.transact(() => {
    const props = propsMap(doc);
    if (value === undefined) props.delete(key);
    else props.set(key, value);
  }, options.origin);
}

/** Writes several page props in one transaction (`undefined` deletes). */
export function setPageProps(
  doc: Y.Doc,
  values: Record<string, JsonValue | undefined>,
  options: { origin?: unknown } = {},
): void {
  doc.transact(() => {
    for (const [key, value] of Object.entries(values)) setPageProp(doc, key, value);
  }, options.origin);
}

/** Observes page props; the listener receives the changed keys. */
export function observePageProps(
  doc: Y.Doc,
  listener: (keys: string[], transaction: Y.Transaction) => void,
): () => void {
  const props = propsMap(doc);
  const handler = (event: Y.YMapEvent<unknown>, transaction: Y.Transaction) =>
    listener([...event.keysChanged], transaction);
  props.observe(handler);
  return () => props.unobserve(handler);
}
