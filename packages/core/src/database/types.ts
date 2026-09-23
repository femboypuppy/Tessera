import { z } from 'zod';
import { ID_PATTERN } from '../ids';
import type { JsonValue } from '../json';

// ---------------------------------------------------------------------------------------------
// Property types
// ---------------------------------------------------------------------------------------------

/**
 * Every property type a database column can have.
 *
 * | type          | stored value                  | notes                                                  |
 * |---------------|-------------------------------|--------------------------------------------------------|
 * | `title`       | none (PageMeta.title)         | exactly one per database; the row page's title         |
 * | `text`        | `string`                      |                                                        |
 * | `number`      | `number` (finite)             | display via {@link NumberConfig}; percent stores ratios |
 * | `select`      | option ID `string`            |                                                        |
 * | `multiSelect` | option IDs `string[]`         | unique, in the order the user picked them              |
 * | `date`        | {@link DateValue}             |                                                        |
 * | `checkbox`    | `boolean`                     | missing means unchecked                                |
 * | `url`         | `string`                      | not validated beyond length; render safely             |
 * | `email`       | `string`                      |                                                        |
 * | `relation`    | page IDs `string[]`           | row pages or any pages, see {@link RelationConfig}     |
 * | `createdTime` | none (PageMeta.createdAt)     |                                                        |
 * | `updatedTime` | none (max of page and row)    | see `resolveRows`                                      |
 * | `formula`     | none (computed)               | reserved; only offered once a formula engine exists    |
 */
export const PROPERTY_TYPES = [
  'title',
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'email',
  'relation',
  'createdTime',
  'updatedTime',
  'formula',
] as const;
export type PropertyType = (typeof PROPERTY_TYPES)[number];

/** Property types whose values are stored in the row's `values` map. */
export const STORED_PROPERTY_TYPES = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'email',
  'relation',
] as const satisfies readonly PropertyType[];
export type StoredPropertyType = (typeof STORED_PROPERTY_TYPES)[number];

/** True when values of this property type live in the row's `values` map. */
export function isStoredPropertyType(type: PropertyType): type is StoredPropertyType {
  return (STORED_PROPERTY_TYPES as readonly string[]).includes(type);
}

/**
 * Named colors for select options, block colors and highlights. Renderers map each name to theme
 * tokens (`--tess-tag-<color>-bg` / `-fg` in `packages/ui`), so colors always work in both themes.
 * Never store raw CSS colors.
 */
export const TAG_COLORS = [
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
] as const;
export type TagColor = (typeof TAG_COLORS)[number];

/** A select or multi-select option. */
export interface SelectOption {
  id: string;
  name: string;
  color: TagColor;
  /** Fractional index; options are listed in this order. */
  order: string;
}

export const NUMBER_FORMATS = ['plain', 'percent', 'currency'] as const;
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

/** Display options of a `number` property. Values are always plain numbers. */
export interface NumberConfig {
  /** `percent` displays the stored ratio times 100 (0.25 shows as 25%). */
  format: NumberFormat;
  /** ISO 4217 code used when `format` is `currency`. */
  currency: string;
  /** Decimal places, or null for automatic. */
  precision: number | null;
}

export const DATE_DISPLAY_FORMATS = ['relative', 'short', 'medium', 'long', 'iso'] as const;
export type DateDisplayFormat = (typeof DATE_DISPLAY_FORMATS)[number];

/** Display options of a `date`, `createdTime` or `updatedTime` property. */
export interface DateConfig {
  format: DateDisplayFormat;
  timeFormat: '12h' | '24h' | 'locale';
}

/** Options of a `relation` property. */
export interface RelationConfig {
  /** Database whose rows can be linked, or null to allow any page. */
  targetDatabaseId: string | null;
  /** For two-way relations: the paired property in the target database. */
  backPropertyId: string | null;
  /** Whether the relation holds one page or many. */
  limit: 'one' | 'many';
}

/** Options of a `formula` property (reserved). */
export interface FormulaConfig {
  expression: string;
}

/**
 * A database property (column). Type-specific options sit in optional blocks, so changing the
 * type keeps them (switching select → text → select restores the options, like Notion).
 */
export interface PropertyDefinition {
  id: string;
  name: string;
  type: PropertyType;
  /** Fractional index: the canonical column order (views may override). */
  order: string;
  description?: string;
  number?: NumberConfig;
  date?: DateConfig;
  relation?: RelationConfig;
  formula?: FormulaConfig;
  /** Options of `select` and `multiSelect` properties, sorted by `order`. */
  options?: SelectOption[];
}

export const DEFAULT_NUMBER_CONFIG: NumberConfig = {
  format: 'plain',
  currency: 'USD',
  precision: null,
};
export const DEFAULT_DATE_CONFIG: DateConfig = { format: 'medium', timeFormat: 'locale' };
export const DEFAULT_RELATION_CONFIG: RelationConfig = {
  targetDatabaseId: null,
  backPropertyId: null,
  limit: 'many',
};

export const MAX_PROPERTY_NAME_LENGTH = 200;
export const MAX_TEXT_VALUE_LENGTH = 100_000;
export const MAX_URL_LENGTH = 4096;

export const tagColorSchema = z.enum(TAG_COLORS);

export const selectOptionSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  name: z.string().min(1).max(MAX_PROPERTY_NAME_LENGTH),
  color: tagColorSchema,
  order: z.string().min(1),
});

export const numberConfigSchema = z.object({
  format: z.enum(NUMBER_FORMATS),
  currency: z.string().regex(/^[A-Z]{3}$/),
  precision: z.number().int().min(0).max(8).nullable(),
});

export const dateConfigSchema = z.object({
  format: z.enum(DATE_DISPLAY_FORMATS),
  timeFormat: z.enum(['12h', '24h', 'locale']),
});

export const relationConfigSchema = z.object({
  targetDatabaseId: z.string().regex(ID_PATTERN).nullable(),
  backPropertyId: z.string().regex(ID_PATTERN).nullable(),
  limit: z.enum(['one', 'many']),
});

export const formulaConfigSchema = z.object({ expression: z.string().max(10_000) });

/** zod schema for {@link PropertyDefinition}. */
export const propertyDefinitionSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  name: z.string().max(MAX_PROPERTY_NAME_LENGTH),
  type: z.enum(PROPERTY_TYPES),
  order: z.string().min(1),
  description: z.string().max(2000).optional(),
  number: numberConfigSchema.optional(),
  date: dateConfigSchema.optional(),
  relation: relationConfigSchema.optional(),
  formula: formulaConfigSchema.optional(),
  options: z.array(selectOptionSchema).optional(),
});

// ---------------------------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------------------------

/**
 * A date (or date range) value.
 * - Without time (`includeTime` false or absent): `start`/`end` are calendar dates `YYYY-MM-DD`
 *   with no time zone (an all-day value that means the same day everywhere).
 * - With time: `start`/`end` are ISO 8601 instants with an offset (`2026-09-23T14:30:00.000Z`);
 *   `timeZone` (IANA, e.g. `Europe/Paris`) records the zone to display them in, or null for the
 *   viewer's zone.
 */
export interface DateValue {
  start: string;
  end?: string | null;
  includeTime?: boolean;
  timeZone?: string | null;
}

/** Stored value types by property type (only {@link STORED_PROPERTY_TYPES} are stored). */
export interface PropertyValueMap {
  text: string;
  number: number;
  select: string;
  multiSelect: string[];
  date: DateValue;
  checkbox: boolean;
  url: string;
  email: string;
  relation: string[];
}

/** Any stored property value. */
export type PropertyValue = PropertyValueMap[StoredPropertyType];

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;

/** True for a real calendar date in `YYYY-MM-DD` form. */
export function isDateOnlyString(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  return (
    date.getUTCFullYear() === Number(y) &&
    date.getUTCMonth() === Number(m) - 1 &&
    date.getUTCDate() === Number(d)
  );
}

/** True for an ISO 8601 date-time with an offset or `Z`. */
export function isDateTimeString(value: string): boolean {
  return (
    DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    isDateOnlyString(value.slice(0, 10))
  );
}

/** zod schema for {@link DateValue}. Enforces the formats above and `end >= start`. */
export const dateValueSchema = z
  .object({
    start: z.string(),
    end: z.string().nullable().optional(),
    includeTime: z.boolean().optional(),
    timeZone: z.string().min(1).max(64).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const check = value.includeTime ? isDateTimeString : isDateOnlyString;
    const expected = value.includeTime ? 'an ISO date-time with offset' : 'a YYYY-MM-DD date';
    if (!check(value.start)) ctx.addIssue({ code: 'custom', message: `start must be ${expected}` });
    if (value.end != null) {
      if (!check(value.end)) ctx.addIssue({ code: 'custom', message: `end must be ${expected}` });
      else if (check(value.start)) {
        const start = value.includeTime ? Date.parse(value.start) : value.start;
        const end = value.includeTime ? Date.parse(value.end) : value.end;
        if (end < start) ctx.addIssue({ code: 'custom', message: 'end must not be before start' });
      }
    }
  });

const idList = z.array(z.string().regex(ID_PATTERN)).max(10_000);

/** zod schemas for stored values, by property type. */
export const propertyValueSchemas = {
  text: z.string().max(MAX_TEXT_VALUE_LENGTH),
  number: z.number().refine(Number.isFinite, 'Numbers must be finite'),
  select: z.string().regex(ID_PATTERN),
  multiSelect: idList.refine((ids) => new Set(ids).size === ids.length, 'Options must be unique'),
  date: dateValueSchema,
  checkbox: z.boolean(),
  url: z.string().max(MAX_URL_LENGTH),
  email: z.string().max(320),
  relation: idList.refine((ids) => new Set(ids).size === ids.length, 'Relations must be unique'),
} satisfies { [K in StoredPropertyType]: z.ZodType<PropertyValueMap[K]> };

/** Result of {@link validatePropertyValue}. */
export type ValueValidation<T> = { success: true; value: T } | { success: false; error: string };

/**
 * Validates a value for a stored property type. Readers should treat values that fail validation
 * as empty (they can appear after a property's type changed or from a newer client).
 *
 * @example
 * validatePropertyValue('number', 42); // { success: true, value: 42 }
 * validatePropertyValue('date', { start: '2026-02-30' }); // { success: false, ... }
 */
export function validatePropertyValue<T extends StoredPropertyType>(
  type: T,
  value: unknown,
): ValueValidation<PropertyValueMap[T]> {
  const schema: z.ZodType<unknown> = propertyValueSchemas[type];
  const result = schema.safeParse(value);
  // The schema for `type` only accepts PropertyValueMap[T], so the parsed data has that type.
  if (result.success) return { success: true, value: result.data as PropertyValueMap[T] };
  return { success: false, error: result.error.issues.map((issue) => issue.message).join('; ') };
}

/** True for values that count as empty: missing, null, '', [], or whitespace-only text. */
export function isEmptyPropertyValue(value: JsonValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}
