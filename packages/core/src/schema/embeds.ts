import { PLUGIN_BLOCK_TYPE_PATTERN, PLUGIN_ID_PATTERN } from '../plugins/manifest';

/** Embed kinds implemented by Tessera itself. */
export const CORE_EMBED_KINDS = ['database', 'web', 'file'] as const;
export type CoreEmbedKind = (typeof CORE_EMBED_KINDS)[number];

/** Prefix of plugin block kinds: `plugin:<pluginId>/<blockType>`. */
export const PLUGIN_EMBED_PREFIX = 'plugin:';

/**
 * Pattern of every valid embed kind: a lowercase name, optionally followed by `:` and a namespaced
 * suffix (`database`, `web`, `plugin:word-count/chart`). At most 128 characters.
 */
export const EMBED_KIND_PATTERN = /^[a-z][a-z0-9-]*(?::[a-z0-9][a-z0-9._/-]*)?$/;

/** Returns true when `kind` is a syntactically valid embed kind. */
export function isValidEmbedKind(kind: unknown): kind is string {
  return typeof kind === 'string' && kind.length <= 128 && EMBED_KIND_PATTERN.test(kind);
}

/**
 * The embed kind of a plugin's custom block.
 *
 * @example
 * pluginBlockKind('mermaid', 'diagram'); // 'plugin:mermaid/diagram'
 */
export function pluginBlockKind(pluginId: string, blockType: string): string {
  if (!PLUGIN_ID_PATTERN.test(pluginId)) throw new TypeError(`Invalid plugin ID "${pluginId}"`);
  if (!PLUGIN_BLOCK_TYPE_PATTERN.test(blockType))
    throw new TypeError(`Invalid block type "${blockType}"`);
  return `${PLUGIN_EMBED_PREFIX}${pluginId}/${blockType}`;
}

/** A parsed embed kind. */
export type ParsedEmbedKind =
  | { type: CoreEmbedKind }
  | { type: 'plugin'; pluginId: string; blockType: string }
  | { type: 'unknown'; kind: string };

/**
 * Parses an embed kind.
 *
 * @example
 * parseEmbedKind('plugin:mermaid/diagram'); // { type: 'plugin', pluginId: 'mermaid', blockType: 'diagram' }
 */
export function parseEmbedKind(kind: string): ParsedEmbedKind {
  if ((CORE_EMBED_KINDS as readonly string[]).includes(kind))
    return { type: kind as CoreEmbedKind };
  if (kind.startsWith(PLUGIN_EMBED_PREFIX)) {
    const rest = kind.slice(PLUGIN_EMBED_PREFIX.length);
    const slash = rest.lastIndexOf('/');
    const pluginId = rest.slice(0, slash);
    const blockType = rest.slice(slash + 1);
    if (
      slash > 0 &&
      PLUGIN_ID_PATTERN.test(pluginId) &&
      PLUGIN_BLOCK_TYPE_PATTERN.test(blockType)
    ) {
      return { type: 'plugin', pluginId, blockType };
    }
  }
  return { type: 'unknown', kind };
}

/** Maximum serialized size of an embed's `data` (bytes of JSON). Larger data belongs in an asset. */
export const MAX_EMBED_DATA_BYTES = 64 * 1024;
