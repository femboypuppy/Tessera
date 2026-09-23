import type {
  JsonValue,
  PageCover,
  PropertyType,
  NumberConfig,
  DateConfig,
  RelationConfig,
  TagColor,
  ViewPatch,
  ViewType,
} from '@tessera/core';

/** What a planned page is: an ordinary page, a database, a database row or a very long page. */
export type PageRole = 'page' | 'database' | 'row' | 'large';

/** One page of a generated workspace (becomes a `PageMeta`). */
export interface PagePlan {
  id: string;
  /** Creation order; parents always come before their children. */
  index: number;
  role: PageRole;
  kind: 'page' | 'database';
  title: string;
  icon?: string;
  cover?: PageCover;
  parentId: string | null;
  /** 0 for top-level pages. */
  depth: number;
  /** The top-level page this page lives under (itself for top-level pages). */
  rootId: string;
  createdAt: number;
  updatedAt: number;
  favorite: boolean;
  /** Trashed directly (its descendants count as trashed too). */
  trashed: boolean;
  topicId: string;
  /** Page-level tags (the `tags` page prop and markdown frontmatter), without `#`. */
  tags: string[];
  /** The `aliases` page prop (link resolution and unlinked mentions). */
  aliases: string[];
  /** Large pages: the exact number of top-level blocks. */
  blockCount?: number;
  /** Rows: the database they belong to. */
  databaseId?: string;
  /** Rows: whether the row page has body content. */
  hasBody?: boolean;
}

export interface PropertyPlan {
  id: string;
  name: string;
  type: PropertyType;
  options?: Array<{ id: string; name: string; color: TagColor }>;
  number?: Partial<NumberConfig>;
  date?: Partial<DateConfig>;
  relation?: Partial<RelationConfig>;
}

export interface ViewPlan extends ViewPatch {
  id: string;
  name: string;
  type: ViewType;
}

export interface RowPlan {
  /** The row page's ID. */
  id: string;
  values: Record<string, JsonValue>;
  /** When the values were written. */
  updatedAt: number;
}

/** A database: its page, schema, views and rows. */
export interface DatabasePlan {
  id: string;
  /** Which template it was built from (`projects`, `reading`, `meetings`). */
  template: string;
  title: string;
  titlePropertyId: string;
  properties: PropertyPlan[];
  views: ViewPlan[];
  rows: RowPlan[];
  createdAt: number;
}

/** A file of the markdown folder export. */
export interface GeneratedFile {
  /** Relative path with `/` separators. */
  path: string;
  content: string;
}

export interface GenerateOptions {
  /** Same seed, same workspace. Default 1. */
  seed?: number | string;
  /** Ordinary pages (databases, rows and large pages come on top). Default 200. */
  pages?: number;
  /** Databases, cycling through the project, reading-list and meeting templates. Default 3. */
  databases?: number;
  /** Rows per database: a number or a `[min, max]` range. Default [12, 40]. */
  rowsPerDatabase?: number | readonly [number, number];
  /** Maximum nesting depth of ordinary pages (0 = top level only). Default 5. */
  maxDepth?: number;
  /** Mean number of `[[links]]` per page. Default 3. */
  linksPerPage?: number;
  /** Extra pages with exactly this many top-level blocks each (for example `[2000]`). */
  largePages?: readonly number[];
  /** Ordinary pages to put in the trash. Default 0. */
  trashed?: number;
  /** "Now" for the generated timestamps (epoch ms). Default 2026-01-15T09:00:00Z. */
  now?: number;
  /** Top folder of the markdown export (none by default). */
  folder?: string;
}

export type ResolvedOptions = Required<Omit<GenerateOptions, 'rowsPerDatabase' | 'folder'>> & {
  rowsPerDatabase: readonly [number, number];
  folder: string;
};
