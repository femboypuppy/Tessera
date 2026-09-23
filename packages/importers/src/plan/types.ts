import type {
  DateValue,
  DocJSON,
  JsonValue,
  NumberConfig,
  PageKind,
  PropertyType,
  TransferIssue,
} from '@tessera/core';

/** Which importer's rules the planner follows. */
export type SourceFormat = 'obsidian' | 'notion' | 'markdown';

/** A text file handed to the planner (markdown or CSV). */
export interface PlanTextFile {
  path: string;
  text: string;
  lastModified?: number;
}

/** An attachment, already stored in the asset store. */
export interface PlanAttachment {
  path: string;
  assetId: string;
  name: string;
  size: number;
  mimeType: string;
}

/** What the planner needs. Plain data, so it can be posted to a worker. */
export interface PlanInput {
  format: SourceFormat;
  files: PlanTextFile[];
  attachments: PlanAttachment[];
  /** Paths ignored on purpose (`.obsidian/`, hidden files), for the report. */
  ignored: string[];
}

/** A cell value before IDs exist: option names instead of option IDs, page keys instead of IDs. */
export type PlanCellValue =
  | { type: 'text'; value: string }
  | { type: 'number'; value: number }
  | { type: 'checkbox'; value: boolean }
  | { type: 'date'; value: DateValue }
  | { type: 'select'; value: string }
  | { type: 'multiSelect'; value: string[] }
  | { type: 'relation'; value: string[] };

/** A database column. `key` is its CSV header. */
export interface PlanProperty {
  key: string;
  name: string;
  type: PropertyType;
  number?: Partial<NumberConfig>;
  options?: string[];
  /** For relations: the database the linked rows belong to, when they all belong to one. */
  relationTargetKey?: string | null;
}

export interface PlanDatabase {
  /** Name of the title column. */
  titleName: string;
  properties: PlanProperty[];
}

/** A page to create. Pages are listed parents first. */
export interface PlanPage {
  /** Unique within the plan (a source path, or a synthetic key). */
  key: string;
  /** Page ID, generated up front so links can point at pages that do not exist yet. */
  id: string;
  /** Parent page key, or null for the import's root page. */
  parentKey: string | null;
  kind: PageKind;
  title: string;
  icon?: string;
  createdAt?: number;
  updatedAt?: number;
  /** Content to write (absent for pages without a body, like folders without a note). */
  doc?: DocJSON;
  /** Page props: tags, aliases and other frontmatter. */
  props?: Record<string, JsonValue>;
  /** Where the page came from, for the report. */
  source?: string;
  database?: PlanDatabase;
  /** For database rows: the values, by property key. */
  values?: Record<string, PlanCellValue>;
}

/** An issue found while planning; `pageKey` becomes a page ID when the plan is applied. */
export interface PlanIssue extends Omit<TransferIssue, 'pageId'> {
  pageKey?: string;
}

/** Everything the planner decided. */
export interface ImportPlan {
  format: SourceFormat;
  pages: PlanPage[];
  /** Attachments that no page references (they are embedded in their folder's page). */
  unreferencedAssets: number;
  /** Page links that resolved. */
  links: number;
  issues: PlanIssue[];
  skippedFiles: number;
  /** Content of the import's root page (attachments at the top level nobody links to). */
  rootDoc?: DocJSON;
}

/** Progress reported by the planner. */
export interface PlanProgress {
  done: number;
  total: number;
  currentFile?: string;
}
