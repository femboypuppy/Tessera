import { z } from 'zod';
import { ID_PATTERN } from '../ids';
import type { PropertyDefinition, PropertyType } from './types';
import { PROPERTY_TYPES } from './types';

// ---------------------------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------------------------

/**
 * Every filter operator. Which ones apply to a property type is listed in
 * {@link FILTER_OPERATORS_BY_TYPE}; the value each operator takes is described in
 * {@link FilterValue}. Evaluation belongs to the query engine in `@tessera/db-views`.
 */
export const FILTER_OPERATORS = [
  // text-like and equality
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'startsWith',
  'endsWith',
  // numbers
  'gt',
  'gte',
  'lt',
  'lte',
  // select
  'isAnyOf',
  'isNoneOf',
  // multi-select
  'containsAnyOf',
  'containsAllOf',
  'containsNoneOf',
  // dates
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isWithin',
  // any type
  'isEmpty',
  'isNotEmpty',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

const TEXT_OPS = [
  'is',
  'isNot',
  'contains',
  'doesNotContain',
  'startsWith',
  'endsWith',
  'isEmpty',
  'isNotEmpty',
] as const;
const DATE_OPS = [
  'is',
  'isBefore',
  'isAfter',
  'isOnOrBefore',
  'isOnOrAfter',
  'isWithin',
  'isEmpty',
  'isNotEmpty',
] as const;

/**
 * Operators allowed for each property type. The value an operator expects:
 *
 * | property types                    | operators                                           | value                         |
 * |-----------------------------------|-----------------------------------------------------|-------------------------------|
 * | title, text, url, email           | is, isNot, contains, doesNotContain, startsWith, endsWith | `string` (case-insensitive) |
 * | number                            | is, isNot, gt, gte, lt, lte                         | `number`                      |
 * | select                            | is, isNot                                           | option ID `string`            |
 * | select                            | isAnyOf, isNoneOf                                   | option IDs `string[]`         |
 * | multiSelect                       | contains, doesNotContain                            | option ID `string`            |
 * | multiSelect                       | containsAnyOf, containsAllOf, containsNoneOf        | option IDs `string[]`         |
 * | date, createdTime, updatedTime    | is, isBefore, isAfter, isOnOrBefore, isOnOrAfter    | {@link DateOperand}           |
 * | date, createdTime, updatedTime    | isWithin                                            | {@link DateRangeOperand}      |
 * | checkbox                          | is                                                  | `boolean`                     |
 * | relation                          | contains, doesNotContain                            | page ID `string`              |
 * | every type                        | isEmpty, isNotEmpty                                 | none                          |
 *
 * Dates compare by calendar day in the viewer's time zone.
 */
export const FILTER_OPERATORS_BY_TYPE: Readonly<Record<PropertyType, readonly FilterOperator[]>> = {
  title: TEXT_OPS,
  text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  number: ['is', 'isNot', 'gt', 'gte', 'lt', 'lte', 'isEmpty', 'isNotEmpty'],
  select: ['is', 'isNot', 'isAnyOf', 'isNoneOf', 'isEmpty', 'isNotEmpty'],
  multiSelect: [
    'contains',
    'doesNotContain',
    'containsAnyOf',
    'containsAllOf',
    'containsNoneOf',
    'isEmpty',
    'isNotEmpty',
  ],
  date: DATE_OPS,
  createdTime: DATE_OPS,
  updatedTime: DATE_OPS,
  checkbox: ['is'],
  relation: ['contains', 'doesNotContain', 'isEmpty', 'isNotEmpty'],
  formula: [
    'is',
    'isNot',
    'contains',
    'doesNotContain',
    'gt',
    'gte',
    'lt',
    'lte',
    'isEmpty',
    'isNotEmpty',
  ],
};

/** Relative date ranges for the `isWithin` operator. Weeks start on the view's `weekStartsOn`. */
export const RELATIVE_DATE_RANGES = [
  'today',
  'yesterday',
  'tomorrow',
  'thisWeek',
  'lastWeek',
  'nextWeek',
  'thisMonth',
  'lastMonth',
  'nextMonth',
  'thisYear',
  'lastYear',
  'nextYear',
  'past7Days',
  'next7Days',
  'past30Days',
  'next30Days',
] as const;
export type RelativeDateRange = (typeof RELATIVE_DATE_RANGES)[number];

/**
 * A single date to compare against: an exact calendar day, or a day relative to today
 * (`{ kind: 'relative', unit: 'day', amount: 0 }` is today, `amount: -7, unit: 'day'` is a week ago).
 */
export type DateOperand =
  | { kind: 'exact'; date: string }
  | { kind: 'relative'; unit: 'day' | 'week' | 'month' | 'year'; amount: number };

/** A date range for `isWithin`: a relative preset, or explicit inclusive calendar days. */
export type DateRangeOperand =
  { kind: 'range'; range: RelativeDateRange } | { kind: 'between'; start: string; end: string };

/** Any filter value (see the table on {@link FILTER_OPERATORS_BY_TYPE}). */
export type FilterValue = string | number | boolean | string[] | DateOperand | DateRangeOperand;

/** A leaf of the filter tree. */
export interface FilterCondition {
  type: 'condition';
  /** Stable ID so the filter builder can key its rows. */
  id: string;
  propertyId: string;
  operator: FilterOperator;
  /** Omitted for `isEmpty`/`isNotEmpty`. A condition with a missing value matches every row. */
  value?: FilterValue;
}

/** A group of conditions joined by AND or OR. Groups nest to any depth (the UI offers two levels). */
export interface FilterGroup {
  type: 'group';
  id: string;
  conjunction: 'and' | 'or';
  children: FilterNode[];
}

export type FilterNode = FilterCondition | FilterGroup;

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const dateOperandSchema: z.ZodType<DateOperand> = z.union([
  z.object({ kind: z.literal('exact'), date: dateOnly }),
  z.object({
    kind: z.literal('relative'),
    unit: z.enum(['day', 'week', 'month', 'year']),
    amount: z.number().int().min(-10_000).max(10_000),
  }),
]);

export const dateRangeOperandSchema: z.ZodType<DateRangeOperand> = z.union([
  z.object({ kind: z.literal('range'), range: z.enum(RELATIVE_DATE_RANGES) }),
  z.object({ kind: z.literal('between'), start: dateOnly, end: dateOnly }),
]);

export const filterValueSchema: z.ZodType<FilterValue> = z.union([
  z.string().max(10_000),
  z.number().refine(Number.isFinite),
  z.boolean(),
  z.array(z.string().max(256)).max(1000),
  dateOperandSchema,
  dateRangeOperandSchema,
]);

export const filterConditionSchema: z.ZodType<FilterCondition> = z.object({
  type: z.literal('condition'),
  id: z.string().min(1).max(64),
  propertyId: z.string().regex(ID_PATTERN),
  operator: z.enum(FILTER_OPERATORS),
  value: filterValueSchema.optional(),
});

/** zod schema for a filter tree (nesting limited to 8 levels). */
export const filterGroupSchema: z.ZodType<FilterGroup> = z
  .lazy(() =>
    z.object({
      type: z.literal('group'),
      id: z.string().min(1).max(64),
      conjunction: z.enum(['and', 'or']),
      children: z.array(z.union([filterConditionSchema, filterGroupSchema])).max(200),
    }),
  )
  .refine((group) => filterDepth(group) <= 8, 'Filters can nest at most 8 levels');

export const filterNodeSchema: z.ZodType<FilterNode> = z.union([
  filterConditionSchema,
  filterGroupSchema,
]);

/** Depth of a filter tree (a group with only conditions has depth 1). */
export function filterDepth(node: FilterNode): number {
  if (node.type === 'condition') return 0;
  return 1 + Math.max(0, ...node.children.map(filterDepth));
}

/** Returns the filter tree without conditions on `propertyId` (empty groups are removed). */
export function removePropertyFromFilter(group: FilterGroup, propertyId: string): FilterGroup {
  const children: FilterNode[] = [];
  for (const child of group.children) {
    if (child.type === 'condition') {
      if (child.propertyId !== propertyId) children.push(child);
    } else {
      const pruned = removePropertyFromFilter(child, propertyId);
      if (pruned.children.length > 0) children.push(pruned);
    }
  }
  return { ...group, children };
}

// ---------------------------------------------------------------------------------------------
// Sorting, grouping, summaries
// ---------------------------------------------------------------------------------------------

/** One sort level. Multiple rules sort by the first, then the second, and so on. Empty values sort last. */
export interface SortRule {
  propertyId: string;
  direction: 'asc' | 'desc';
}

/** Group key for rows whose grouping property is empty. */
export const EMPTY_GROUP_KEY = '__empty__';

/**
 * Grouping (board columns, table groups). Group keys:
 * - select and multiSelect: the option ID (a multi-select row appears in every group it has);
 * - checkbox: `'true'` or `'false'`;
 * - date, createdTime, updatedTime: the bucket (`YYYY-MM-DD`, `YYYY-Www`, `YYYY-MM` or `YYYY`);
 * - other types: the value as a string;
 * - empty values: {@link EMPTY_GROUP_KEY}.
 */
export interface GroupConfig {
  propertyId: string;
  /** Explicit group order; groups not listed follow in their natural order. */
  order: string[];
  hidden: string[];
  collapsed: string[];
  hideEmptyGroups: boolean;
  dateBucket: 'day' | 'week' | 'month' | 'year';
}

/** Table footer summaries. */
export const SUMMARY_KINDS = [
  'none',
  'count',
  'countEmpty',
  'countNotEmpty',
  'countUnique',
  'percentEmpty',
  'percentNotEmpty',
  'sum',
  'average',
  'median',
  'min',
  'max',
  'range',
  'countChecked',
  'countUnchecked',
  'percentChecked',
  'percentUnchecked',
  'earliest',
  'latest',
  'dateRange',
] as const;
export type SummaryKind = (typeof SUMMARY_KINDS)[number];

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

export const VIEW_TYPES = ['table', 'board', 'calendar', 'gallery', 'list'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];

export type CardSize = 'small' | 'medium' | 'large';

/** What a board or gallery card shows at the top. `pageContent` is the first image in the row page. */
export type CardCover =
  { kind: 'none' } | { kind: 'pageContent' } | { kind: 'property'; propertyId: string };

/** Per-view state of one property (column). */
export interface ViewPropertyConfig {
  propertyId: string;
  visible: boolean;
  /** Column width in CSS pixels (table view). */
  width?: number;
}

export interface TableOptions {
  wrapCells: boolean;
  /** Number of leading columns that stay visible while scrolling horizontally. */
  frozenColumns: number;
  /** Footer summary per property ID. */
  summaries: Record<string, SummaryKind>;
}

export interface CardOptions {
  size: CardSize;
  cover: CardCover;
  /** Show the whole cover image (contain) instead of cropping it (cover). */
  fitCover: boolean;
  showPropertyNames: boolean;
}

export interface BoardOptions extends CardOptions {
  /** Tint columns with their option color. */
  colorColumns: boolean;
}

export interface CalendarOptions {
  /** Date property that places rows on the calendar (null: pick the first date property). */
  datePropertyId: string | null;
  mode: 'month' | 'week';
  /** 0 = Sunday, 1 = Monday. Also used by relative week filters. */
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
}

export type GalleryOptions = CardOptions;

export interface ListOptions {
  showPropertyNames: boolean;
}

/**
 * A saved view of a database. A view keeps the options of every layout, so switching a view from
 * table to board and back loses nothing.
 */
export interface ViewConfig {
  id: string;
  name: string;
  type: ViewType;
  /** Fractional index: tab order. */
  order: string;
  /** Root filter group, or null for no filter. */
  filter: FilterGroup | null;
  sorts: SortRule[];
  group: GroupConfig | null;
  /**
   * Column order, visibility and widths. Properties not listed are appended in schema order;
   * they are visible in table views and hidden on cards (board, gallery, list, calendar), except the
   * title, which is always shown. Use {@link resolveViewProperties} instead of reading this directly.
   */
  properties: ViewPropertyConfig[];
  table: TableOptions;
  board: BoardOptions;
  calendar: CalendarOptions;
  gallery: GalleryOptions;
  list: ListOptions;
}

export const DEFAULT_TABLE_OPTIONS: TableOptions = {
  wrapCells: false,
  frozenColumns: 1,
  summaries: {},
};
export const DEFAULT_BOARD_OPTIONS: BoardOptions = {
  size: 'medium',
  cover: { kind: 'none' },
  fitCover: false,
  showPropertyNames: false,
  colorColumns: true,
};
export const DEFAULT_CALENDAR_OPTIONS: CalendarOptions = {
  datePropertyId: null,
  mode: 'month',
  weekStartsOn: 1,
  showWeekends: true,
};
export const DEFAULT_GALLERY_OPTIONS: GalleryOptions = {
  size: 'medium',
  cover: { kind: 'pageContent' },
  fitCover: false,
  showPropertyNames: false,
};
export const DEFAULT_LIST_OPTIONS: ListOptions = { showPropertyNames: false };

const cardCoverSchema: z.ZodType<CardCover> = z.union([
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('pageContent') }),
  z.object({ kind: z.literal('property'), propertyId: z.string().regex(ID_PATTERN) }),
]);

const cardOptionsShape = {
  size: z.enum(['small', 'medium', 'large']),
  cover: cardCoverSchema,
  fitCover: z.boolean(),
  showPropertyNames: z.boolean(),
};

export const sortRuleSchema: z.ZodType<SortRule> = z.object({
  propertyId: z.string().regex(ID_PATTERN),
  direction: z.enum(['asc', 'desc']),
});

export const groupConfigSchema: z.ZodType<GroupConfig> = z.object({
  propertyId: z.string().regex(ID_PATTERN),
  order: z.array(z.string().max(256)).max(1000),
  hidden: z.array(z.string().max(256)).max(1000),
  collapsed: z.array(z.string().max(256)).max(1000),
  hideEmptyGroups: z.boolean(),
  dateBucket: z.enum(['day', 'week', 'month', 'year']),
});

export const viewPropertyConfigSchema: z.ZodType<ViewPropertyConfig> = z.object({
  propertyId: z.string().regex(ID_PATTERN),
  visible: z.boolean(),
  width: z.number().int().min(40).max(2000).optional(),
});

/** zod schemas for every field of {@link ViewConfig} (used field by field when reading views). */
export const viewFieldSchemas = {
  id: z.string().regex(ID_PATTERN),
  name: z.string().max(200),
  type: z.enum(VIEW_TYPES),
  order: z.string().min(1),
  filter: filterGroupSchema.nullable(),
  sorts: z.array(sortRuleSchema).max(50),
  group: groupConfigSchema.nullable(),
  properties: z.array(viewPropertyConfigSchema).max(1000),
  table: z.object({
    wrapCells: z.boolean(),
    frozenColumns: z.number().int().min(0).max(10),
    summaries: z.record(z.string(), z.enum(SUMMARY_KINDS)),
  }),
  board: z.object({ ...cardOptionsShape, colorColumns: z.boolean() }),
  calendar: z.object({
    datePropertyId: z.string().regex(ID_PATTERN).nullable(),
    mode: z.enum(['month', 'week']),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]),
    showWeekends: z.boolean(),
  }),
  gallery: z.object(cardOptionsShape),
  list: z.object({ showPropertyNames: z.boolean() }),
} as const;

/** zod schema for a complete {@link ViewConfig}. */
export const viewConfigSchema = z.object(viewFieldSchemas);

/** Creates a view with every option at its default. */
export function createDefaultView(input: {
  id: string;
  name: string;
  type: ViewType;
  order: string;
}): ViewConfig {
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    order: input.order,
    filter: null,
    sorts: [],
    group: null,
    properties: [],
    table: structuredClone(DEFAULT_TABLE_OPTIONS),
    board: structuredClone(DEFAULT_BOARD_OPTIONS),
    calendar: structuredClone(DEFAULT_CALENDAR_OPTIONS),
    gallery: structuredClone(DEFAULT_GALLERY_OPTIONS),
    list: structuredClone(DEFAULT_LIST_OPTIONS),
  };
}

/** Creates an empty root filter group. */
export function createFilterGroup(id: string, conjunction: 'and' | 'or' = 'and'): FilterGroup {
  return { type: 'group', id, conjunction, children: [] };
}

/** A property as a view shows it. */
export interface ResolvedViewProperty {
  property: PropertyDefinition;
  visible: boolean;
  width?: number;
}

/**
 * Resolves the ordered, visibility-annotated property list of a view: the view's explicit entries
 * first (skipping deleted properties), then any remaining properties in schema order, visible in
 * tables and hidden on cards. The title property is always visible.
 *
 * @example
 * const columns = resolveViewProperties(listProperties(dbDoc), view).filter((c) => c.visible);
 */
export function resolveViewProperties(
  properties: readonly PropertyDefinition[],
  view: Pick<ViewConfig, 'type' | 'properties'>,
): ResolvedViewProperty[] {
  const byId = new Map(properties.map((property) => [property.id, property]));
  const seen = new Set<string>();
  const result: ResolvedViewProperty[] = [];
  for (const entry of view.properties) {
    const property = byId.get(entry.propertyId);
    if (!property || seen.has(property.id)) continue;
    seen.add(property.id);
    const resolved: ResolvedViewProperty = {
      property,
      visible: property.type === 'title' || entry.visible,
    };
    if (entry.width !== undefined) resolved.width = entry.width;
    result.push(resolved);
  }
  for (const property of properties) {
    if (seen.has(property.id)) continue;
    result.push({ property, visible: property.type === 'title' || view.type === 'table' });
  }
  return result;
}

/** Property types that a board can group by. */
export const BOARD_GROUPABLE_TYPES: readonly PropertyType[] = ['select', 'multiSelect', 'checkbox'];

/** True when `type` is a known property type. */
export function isPropertyType(type: unknown): type is PropertyType {
  return typeof type === 'string' && (PROPERTY_TYPES as readonly string[]).includes(type);
}
