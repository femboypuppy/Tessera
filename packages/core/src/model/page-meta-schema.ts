import { z } from 'zod';
import { ID_PATTERN } from '../ids';
import {
  MAX_COVER_VALUE_LENGTH,
  MAX_TITLE_LENGTH,
  PAGE_COVER_KINDS,
  PAGE_KINDS,
} from './page-meta';

// zod schemas live apart from `page-meta.ts`, so the page helpers (on the startup path) don't
// pull zod into the shell bundle. `parsePageCover` applies the same cover rules without zod.

/** zod schema for {@link PageCover}. */
export const pageCoverSchema = z.object({
  kind: z.enum(PAGE_COVER_KINDS),
  value: z.string().min(1).max(MAX_COVER_VALUE_LENGTH),
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
