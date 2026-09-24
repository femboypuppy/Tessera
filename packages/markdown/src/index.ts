/**
 * @tessera/markdown — the Tessera markdown engine (Agent 08): Obsidian-flavored markdown and
 * sanitized HTML to and from the canonical document schema. Implements `MarkdownCodec` from
 * `@tessera/core`; the import-export feature registers it as the `markdownCodec` service
 * (priority 50) and loads it lazily, so unified and remark stay out of the startup bundle.
 */
export {
  RemarkMarkdownCodec,
  createMarkdownCodec,
  remarkTessera,
  type TesseraParseOptions,
} from './codec';
export {
  CALLOUT_TYPES,
  formatCalloutMarker,
  parseCalloutMarker,
  type CalloutHeader,
} from './callouts';
export {
  ASSET_URL_PREFIX,
  EMBED_FENCE_LANGUAGE,
  isEmbeddableUrl,
  isImagePath,
  formatEmbedFence,
  parseEmbedFence,
} from './embeds';
export { parseFrontmatter, stringifyFrontmatter, type FrontmatterResult } from './frontmatter';
export { decodeEntities, tokenizeHtml, type HtmlToken } from './html/tokenize';
export { encodePath } from './from-doc';
export { formatWikiLink, parseWikiLink, type WikiLinkParts } from './wikilinks';
