import type { JsonValue } from '../json';
import { extractTextBlocks } from '../schema/extract';
import { normalizeDocJSON } from '../schema/docjson';
import type { AnyNodeJSON, DocJSON } from '../schema/types';

/** Result of {@link MarkdownCodec.parse}. */
export interface MarkdownParseResult {
  doc: DocJSON;
  /** YAML frontmatter as JSON (empty object when absent). */
  frontmatter: Record<string, JsonValue>;
  /** Things that could not be represented exactly (unsupported syntax, unresolved links). */
  warnings: string[];
}

/** Options for {@link MarkdownCodec.parse}. */
export interface MarkdownParseOptions {
  /**
   * Resolves a `[[wikilink]]` target (the part before `#`, `^` and `|`) to a page ID. Unresolved
   * links stay as literal `[[text]]` and produce a warning.
   */
  resolvePageLink?: (target: string) => string | null | undefined;
  /** Resolves an image or attachment path to an asset ID (imports). Unresolved paths stay as `src`. */
  resolveAsset?: (path: string) => string | null | undefined;
}

/** Options for {@link MarkdownCodec.serialize}. */
export interface MarkdownSerializeOptions {
  /** `wikilink` (`[[Title]]`, the default, Obsidian-compatible) or `markdown` (`[Title](path.md)`). */
  linkStyle?: 'wikilink' | 'markdown';
  /** Title and export path of a linked page (for link text and relative links). */
  resolvePage?: (pageId: string) => { title: string; path?: string } | null | undefined;
  /** Export path of an asset (for images and attachments). */
  resolveAssetPath?: (assetId: string) => string | null | undefined;
  /** Frontmatter to write at the top. */
  frontmatter?: Record<string, JsonValue>;
}

/**
 * Converts between markdown/HTML and {@link DocJSON}. Methods are synchronous (copy handlers need
 * that); implementations load their parsers in the service's async `create`. Implementations:
 * basic stub (core, 0: paragraphs and headings only) and unified/remark (`@tessera/markdown`, 50).
 * `parseHTML` output is sanitized: it never contains raw HTML.
 *
 * @example
 * const { doc, frontmatter } = ctx.services.markdownCodec.parse(text, { resolvePageLink });
 * const md = ctx.services.markdownCodec.serialize(readDocJSON(handle.doc), { linkStyle: 'wikilink' });
 */
export interface MarkdownCodec {
  parse(markdown: string, options?: MarkdownParseOptions): MarkdownParseResult;
  serialize(doc: DocJSON, options?: MarkdownSerializeOptions): string;
  parseHTML(html: string): DocJSON;
}

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

function parseScalar(raw: string): JsonValue {
  const value = raw.trim();
  if (value === 'true' || value === 'false') return value === 'true';
  if (value === 'null' || value === '~' || value === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (/^\[.*\]$/.test(value)) {
    return value
      .slice(1, -1)
      .split(',')
      .map((item) => item.trim().replace(/^["']|["']$/g, ''))
      .filter(Boolean);
  }
  return value.replace(/^["']|["']$/g, '');
}

function paragraphNode(text: string): AnyNodeJSON {
  return text ? { type: 'paragraph', content: [{ type: 'text', text }] } : { type: 'paragraph' };
}

/**
 * The stub {@link MarkdownCodec}: headings (`#`, `##`, `###`; deeper levels become level 3) and
 * paragraphs only, simple `key: value` frontmatter. Everything else is kept as plain text so
 * nothing is lost. `@tessera/markdown` replaces it.
 */
export class BasicMarkdownCodec implements MarkdownCodec {
  parse(markdown: string): MarkdownParseResult {
    const warnings: string[] = [];
    const frontmatter: Record<string, JsonValue> = {};
    // Drop a leading byte order mark (0xFEFF).
    let body = markdown.charCodeAt(0) === 0xfeff ? markdown.slice(1) : markdown;
    const match = FRONTMATTER.exec(body);
    if (match) {
      body = body.slice(match[0].length);
      for (const line of (match[1] ?? '').split(/\r?\n/)) {
        const pair = /^([A-Za-z0-9_.-]+):(.*)$/.exec(line);
        if (pair?.[1]) frontmatter[pair[1]] = parseScalar(pair[2] ?? '');
        else if (line.trim()) warnings.push(`Unsupported frontmatter line: ${line.trim()}`);
      }
    }
    const content: AnyNodeJSON[] = [];
    for (const block of body.split(/\r?\n\s*\r?\n/)) {
      const lines = block
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (!lines.length) continue;
      const heading = /^(#{1,6})\s+(.*)$/.exec(lines[0] ?? '');
      if (heading?.[1] && lines.length === 1) {
        const level = Math.min(3, heading[1].length);
        content.push({
          type: 'heading',
          attrs: { level },
          content: heading[2] ? [{ type: 'text', text: heading[2] }] : [],
        });
      } else {
        content.push(paragraphNode(lines.join(' ')));
      }
    }
    return { doc: normalizeDocJSON({ type: 'doc', content }), frontmatter, warnings };
  }

  serialize(doc: DocJSON, options: MarkdownSerializeOptions = {}): string {
    const blocks = extractTextBlocks(doc, {
      resolveTitle: (pageId) => options.resolvePage?.(pageId)?.title,
    }).map((block) =>
      block.type === 'heading'
        ? `${'#'.repeat(block.level ?? 1)} ${block.text}`
        : block.text.replace(/\n/g, '  \n'),
    );
    const body = blocks.filter((text) => text.length > 0).join('\n\n');
    const entries = Object.entries(options.frontmatter ?? {});
    if (!entries.length) return body ? `${body}\n` : '';
    const yaml = entries.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join('\n');
    return `---\n${yaml}\n---\n\n${body}${body ? '\n' : ''}`;
  }

  parseHTML(html: string): DocJSON {
    const content: AnyNodeJSON[] = [];
    if (typeof DOMParser !== 'undefined') {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      parsed.querySelectorAll('script, style, template').forEach((node) => node.remove());
      const blocks = parsed.body.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, pre, td, th');
      for (const element of blocks) {
        const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const level = /^H([1-6])$/.exec(element.tagName)?.[1];
        content.push(
          level
            ? {
                type: 'heading',
                attrs: { level: Math.min(3, Number(level)) },
                content: [{ type: 'text', text }],
              }
            : paragraphNode(text),
        );
      }
      if (!content.length) {
        const text = (parsed.body.textContent ?? '').replace(/\s+/g, ' ').trim();
        if (text) content.push(paragraphNode(text));
      }
    } else {
      const text = html
        .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n')
        .replace(/<[^>]*>/g, ' ');
      for (const line of text.split(/\n+/)) {
        const clean = line.replace(/\s+/g, ' ').trim();
        if (clean) content.push(paragraphNode(clean));
      }
    }
    return normalizeDocJSON({ type: 'doc', content });
  }
}
