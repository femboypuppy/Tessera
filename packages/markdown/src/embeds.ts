import {
  isHttpUrl,
  isJsonValue,
  isValidBlockId,
  isValidEmbedKind,
  type JsonValue,
} from '@tessera/core';

/** Info string of the fenced code block that stores any embed losslessly. */
export const EMBED_FENCE_LANGUAGE = 'tessera-embed';

/** Scheme used for asset references when no export path is known (clipboard, tests). */
export const ASSET_URL_PREFIX = 'tessera-asset:';

/** Hosts whose pages Obsidian (and Tessera) embed from image syntax: `![](https://youtu.be/…)`. */
const EMBED_HOSTS = [
  'youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'vimeo.com',
  'loom.com',
  'figma.com',
  'codepen.io',
  'twitter.com',
  'x.com',
];

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)$/i;

/** True for URLs of embeddable pages (videos, designs, pens), not direct images. */
export function isEmbeddableUrl(url: string): boolean {
  if (!isHttpUrl(url)) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (IMAGE_EXTENSION.test(parsed.pathname)) return false;
  const host = parsed.hostname.toLowerCase().replace(/^(www|m)\./, '');
  return EMBED_HOSTS.some((candidate) => host === candidate || host.endsWith(`.${candidate}`));
}

/** True when a path or file name has an image extension. */
export function isImagePath(path: string): boolean {
  return IMAGE_EXTENSION.test(path);
}

/** The embed stored in a `tessera-embed` code block. */
export interface FencedEmbed {
  kind: string;
  ref: string | null;
  data: JsonValue | null;
  blockId: string | null;
}

/** Formats an embed as the content of a `tessera-embed` code block (stable key order). */
export function formatEmbedFence(embed: FencedEmbed): string {
  const value: Record<string, JsonValue> = { kind: embed.kind };
  if (embed.ref !== null) value.ref = embed.ref;
  if (embed.data !== null) value.data = embed.data;
  if (embed.blockId !== null) value.blockId = embed.blockId;
  return JSON.stringify(value, null, 2);
}

/** Parses the content of a `tessera-embed` code block, or returns null when it is not one. */
export function parseEmbedFence(source: string): FencedEmbed | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isValidEmbedKind(record.kind)) return null;
  const ref = typeof record.ref === 'string' ? record.ref : null;
  const data = record.data !== undefined && isJsonValue(record.data) ? record.data : null;
  const blockId = isValidBlockId(record.blockId) ? record.blockId : null;
  return { kind: record.kind, ref, data, blockId };
}
