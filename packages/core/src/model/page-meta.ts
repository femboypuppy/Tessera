import { z } from 'zod';
import { ID_PATTERN } from '../ids';

/** What a page's body is. `database` pages render a database; their rows are child pages. */
export const PAGE_KINDS = ['page', 'database'] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/**
 * A page cover.
 * - `preset`: one of the built-in covers from `packages/ui` (`value` is the preset name).
 * - `asset`: an uploaded image (`value` is an asset ID from the `AssetStore`).
 * - `url`: a remote image (`value` is an `https:` URL).
 */
export interface PageCover {
  kind: 'preset' | 'asset' | 'url';
  value: string;
  /** Vertical focus point in percent (0 = top, 100 = bottom). Defaults to 50. */
  positionY?: number;
}

/**
 * Metadata of one page, stored in the workspace doc so the sidebar, search, link autocomplete and
 * breadcrumbs work without loading page docs. Database rows are pages too: their `parentId` is
 * the database page, and their property values live in the database doc.
 */
export interface PageMeta {
  /** nanoid(21). Also the ID of the page doc (`page:<id>`) and, for databases, of the database doc (`db:<id>`). */
  id: string;
  kind: PageKind;
  /** Plain-text title. Empty string means "Untitled" (render `t('untitled')`, never store it). */
  title: string;
  /** A single emoji. */
  icon?: string;
  cover?: PageCover;
  /** Parent page ID, or null for a top-level page. */
  parentId: string | null;
  /** Fractional index among siblings. Sort with `compareOrdered` (order, then id). */
  order: string;
  /** Epoch milliseconds. */
  createdAt: number;
  /** Epoch milliseconds of the last edit to the title, content, icon, cover or (for rows) values. */
  updatedAt: number;
  /** User ID of the creator. */
  createdBy?: string;
  /** User ID of the last editor. */
  updatedBy?: string;
  /** Epoch milliseconds when this page itself was moved to the trash. Descendants are trashed implicitly. */
  trashedAt?: number;
  /** User ID of whoever trashed it. */
  trashedBy?: string;
  favorite?: boolean;
}

/** Maximum title length. Longer titles are truncated by the helpers. */
export const MAX_TITLE_LENGTH = 2000;

/** zod schema for {@link PageCover}. */
export const pageCoverSchema = z.object({
  kind: z.enum(['preset', 'asset', 'url']),
  value: z.string().min(1).max(2048),
  positionY: z.number().min(0).max(100).optional(),
});

/** zod schema for {@link PageMeta}. Use it at trust boundaries (imports, plugin API, server). */
export const pageMetaSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  kind: z.enum(PAGE_KINDS),
  title: z.string().max(MAX_TITLE_LENGTH),
  icon: z.string().min(1).max(64).optional(),
  cover: pageCoverSchema.optional(),
  parentId: z.string().regex(ID_PATTERN).nullable(),
  order: z.string().min(1).max(256),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  createdBy: z.string().max(128).optional(),
  updatedBy: z.string().max(128).optional(),
  trashedAt: z.number().int().nonnegative().optional(),
  trashedBy: z.string().max(128).optional(),
  favorite: z.boolean().optional(),
});

/** Keys of {@link PageMeta}. */
export type PageMetaField = keyof PageMeta;

/** Every PageMeta field, in a stable order. */
export const PAGE_META_FIELDS = [
  'id',
  'kind',
  'title',
  'icon',
  'cover',
  'parentId',
  'order',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'trashedAt',
  'trashedBy',
  'favorite',
] as const satisfies readonly PageMetaField[];

/** Normalizes a title: no line breaks, no control characters, at most {@link MAX_TITLE_LENGTH} characters. */
export function normalizeTitle(title: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point here
  const cleaned = title.replace(/[\r\n\t]+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '');
  return cleaned.length > MAX_TITLE_LENGTH ? cleaned.slice(0, MAX_TITLE_LENGTH) : cleaned;
}

/** Returns true when `icon` looks like a single emoji (or short symbol) usable as a page icon. */
export function isValidIcon(icon: unknown): icon is string {
  if (typeof icon !== 'string' || icon.length === 0 || icon.length > 64) return false;
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let count = 0;
  for (const _ of segmenter.segment(icon)) {
    count += 1;
    if (count > 1) return false;
  }
  return count === 1;
}
