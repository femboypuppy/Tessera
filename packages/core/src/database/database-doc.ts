import * as Y from 'yjs';
import { InvalidOperationError, NotFoundError, ValidationError } from '../errors';
import { isValidId, newId } from '../ids';
import { isJsonValue, type JsonValue } from '../json';
import type { PageIndex } from '../model/page-index';
import type { MutationOptions } from '../model/pages';
import {
  compareOrdered,
  orderAfterAll,
  orderForIndex,
  ordersBetween,
  positionToIndex,
  type ListPosition,
} from '../order';
import {
  DEFAULT_DATE_CONFIG,
  DEFAULT_NUMBER_CONFIG,
  DEFAULT_RELATION_CONFIG,
  MAX_PROPERTY_NAME_LENGTH,
  TAG_COLORS,
  dateConfigSchema,
  formulaConfigSchema,
  isStoredPropertyType,
  numberConfigSchema,
  relationConfigSchema,
  selectOptionSchema,
  validatePropertyValue,
  type DateConfig,
  type FormulaConfig,
  type NumberConfig,
  type PropertyDefinition,
  type PropertyType,
  type RelationConfig,
  type SelectOption,
  type TagColor,
} from './types';
import {
  DEFAULT_BOARD_OPTIONS,
  DEFAULT_CALENDAR_OPTIONS,
  DEFAULT_GALLERY_OPTIONS,
  DEFAULT_LIST_OPTIONS,
  DEFAULT_TABLE_OPTIONS,
  createDefaultView,
  isPropertyType,
  removePropertyFromFilter,
  viewFieldSchemas,
  type BoardOptions,
  type CalendarOptions,
  type GalleryOptions,
  type ListOptions,
  type TableOptions,
  type ViewConfig,
  type ViewType,
} from './views';
import { DATA_MODEL_VERSION } from '../model/workspace-doc';

/**
 * Top-level shared types of a database doc (`db:<databaseId>`). Internal to core: use the
 * helpers below.
 */
export const DATABASE_DOC_KEYS = {
  /** `Y.Map<propertyId, Y.Map>`; select options in a nested `options` Y.Map. */
  schema: 'schema',
  /** `Y.Map<viewId, Y.Map<ViewConfig field, JSON>>` */
  views: 'views',
  /** `Y.Map<rowId, Y.Map{ order, values: Y.Map<propertyId, JSON>, valuesUpdatedAt, valuesUpdatedBy }>` */
  rows: 'rows',
  /** `Y.Map`: `schemaVersion`, `createdAt`, `rowTemplateId`. */
  meta: 'meta',
} as const;

const schemaOf = (db: Y.Doc) => db.getMap<unknown>(DATABASE_DOC_KEYS.schema);
const viewsOf = (db: Y.Doc) => db.getMap<unknown>(DATABASE_DOC_KEYS.views);
const rowsOf = (db: Y.Doc) => db.getMap<unknown>(DATABASE_DOC_KEYS.rows);
const metaOf = (db: Y.Doc) => db.getMap<unknown>(DATABASE_DOC_KEYS.meta);

function asMap(value: unknown): Y.Map<unknown> | null {
  return value instanceof Y.Map ? (value as Y.Map<unknown>) : null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function normalizeName(name: string): string {
  const cleaned = name.replace(/[\r\n\t]+/g, ' ').trim();
  return cleaned.length > MAX_PROPERTY_NAME_LENGTH
    ? cleaned.slice(0, MAX_PROPERTY_NAME_LENGTH)
    : cleaned;
}

// ---------------------------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------------------------

/** Database-level settings. */
export interface DatabaseMeta {
  schemaVersion: number | null;
  createdAt: number | null;
  /** Page whose content and props are copied into new rows ("row template"), or null. */
  rowTemplateId: string | null;
}

/** Reads database-level settings. */
export function getDatabaseMeta(db: Y.Doc): DatabaseMeta {
  const meta = metaOf(db);
  const version = meta.get('schemaVersion');
  const createdAt = meta.get('createdAt');
  return {
    schemaVersion: typeof version === 'number' ? version : null,
    createdAt: typeof createdAt === 'number' ? createdAt : null,
    rowTemplateId: str(meta.get('rowTemplateId')) ?? null,
  };
}

/** Sets (or clears) the row template page. */
export function setRowTemplate(
  db: Y.Doc,
  pageId: string | null,
  options: MutationOptions = {},
): void {
  if (pageId !== null && !isValidId(pageId)) throw new ValidationError('Invalid page ID', [pageId]);
  db.transact(() => {
    if (pageId === null) metaOf(db).delete('rowTemplateId');
    else metaOf(db).set('rowTemplateId', pageId);
  }, options.origin);
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

function readOptions(value: unknown): SelectOption[] {
  const map = asMap(value);
  if (!map) return [];
  const options: SelectOption[] = [];
  map.forEach((raw, id) => {
    const parsed = selectOptionSchema.safeParse(raw);
    if (parsed.success && parsed.data.id === id) options.push(parsed.data);
  });
  return options.sort(compareOrdered);
}

/** @internal */
export function readProperty(id: string, value: unknown): PropertyDefinition | null {
  const map = asMap(value);
  if (!map) return null;
  const type = map.get('type');
  // Unknown types (from a newer client) are skipped but left untouched in the doc.
  if (!isPropertyType(type)) return null;
  const property: PropertyDefinition = {
    id,
    name: str(map.get('name')) ?? '',
    type,
    order: str(map.get('order')) || 'a0',
  };
  const description = str(map.get('description'));
  if (description) property.description = description;
  const number = numberConfigSchema.safeParse(map.get('number'));
  if (number.success) property.number = number.data;
  else if (type === 'number') property.number = { ...DEFAULT_NUMBER_CONFIG };
  const date = dateConfigSchema.safeParse(map.get('date'));
  if (date.success) property.date = date.data;
  else if (type === 'date' || type === 'createdTime' || type === 'updatedTime')
    property.date = { ...DEFAULT_DATE_CONFIG };
  const relation = relationConfigSchema.safeParse(map.get('relation'));
  if (relation.success) property.relation = relation.data;
  else if (type === 'relation') property.relation = { ...DEFAULT_RELATION_CONFIG };
  const formula = formulaConfigSchema.safeParse(map.get('formula'));
  if (formula.success) property.formula = formula.data;
  if (map.has('options') || type === 'select' || type === 'multiSelect')
    property.options = readOptions(map.get('options'));
  return property;
}

function propertyMap(db: Y.Doc, id: string): Y.Map<unknown> {
  const map = asMap(schemaOf(db).get(id));
  if (!map || !readProperty(id, map)) throw new NotFoundError('Property', id);
  return map;
}

/**
 * Lists the properties of a database in canonical (schema) order.
 *
 * @example
 * const [title, ...rest] = listProperties(dbDoc);
 */
export function listProperties(db: Y.Doc): PropertyDefinition[] {
  const result: PropertyDefinition[] = [];
  schemaOf(db).forEach((value, id) => {
    const property = readProperty(id, value);
    if (property) result.push(property);
  });
  return result.sort(compareOrdered);
}

/** Returns one property, or undefined. */
export function getProperty(db: Y.Doc, id: string): PropertyDefinition | undefined {
  return readProperty(id, schemaOf(db).get(id)) ?? undefined;
}

/** Returns the title property (every initialized database has exactly one). */
export function getTitleProperty(db: Y.Doc): PropertyDefinition | undefined {
  return listProperties(db).find((property) => property.type === 'title');
}

/** Input for {@link addProperty}. */
export interface AddPropertyInput {
  id?: string;
  name: string;
  type: PropertyType;
  /** Defaults to `'end'`. */
  position?: ListPosition;
  description?: string;
  number?: Partial<NumberConfig>;
  date?: Partial<DateConfig>;
  relation?: Partial<RelationConfig>;
  formula?: FormulaConfig;
  /** Initial options for select and multi-select properties. */
  options?: Array<{ id?: string; name: string; color?: TagColor }>;
}

function validated<T>(
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  value: unknown,
  what: string,
): T {
  const result = schema.safeParse(value);
  if (!result.success || result.data === undefined) throw new ValidationError(`Invalid ${what}`);
  return result.data;
}

type TypeConfigInput = Pick<AddPropertyInput, 'number' | 'date' | 'relation' | 'formula'>;

/**
 * Validates and computes the config fields to write. Yjs transactions do not roll back when an
 * error is thrown, so every helper validates everything before its first write.
 */
function computeTypeConfig(
  existing: Y.Map<unknown> | null,
  type: PropertyType,
  input: TypeConfigInput,
  current?: PropertyDefinition,
): Array<[string, unknown]> {
  const writes: Array<[string, unknown]> = [];
  const has = (key: string) => existing?.has(key) ?? false;
  if (input.number || (type === 'number' && !has('number'))) {
    writes.push([
      'number',
      validated(
        numberConfigSchema,
        { ...DEFAULT_NUMBER_CONFIG, ...current?.number, ...input.number },
        'number format',
      ),
    ]);
  }
  if (
    input.date ||
    ((type === 'date' || type === 'createdTime' || type === 'updatedTime') && !has('date'))
  ) {
    writes.push([
      'date',
      validated(
        dateConfigSchema,
        { ...DEFAULT_DATE_CONFIG, ...current?.date, ...input.date },
        'date format',
      ),
    ]);
  }
  if (input.relation || (type === 'relation' && !has('relation'))) {
    writes.push([
      'relation',
      validated(
        relationConfigSchema,
        { ...DEFAULT_RELATION_CONFIG, ...current?.relation, ...input.relation },
        'relation',
      ),
    ]);
  }
  if (input.formula)
    writes.push(['formula', validated(formulaConfigSchema, input.formula, 'formula')]);
  return writes;
}

function ensureOptionsMap(map: Y.Map<unknown>, type: PropertyType): void {
  if ((type === 'select' || type === 'multiSelect') && !(map.get('options') instanceof Y.Map)) {
    map.set('options', new Y.Map<unknown>());
  }
}

function nextOptionColor(existing: number): TagColor {
  const palette = TAG_COLORS.filter((color) => color !== 'default');
  return palette[existing % palette.length] ?? 'gray';
}

/**
 * Adds a property. A database has exactly one `title` property (created by
 * {@link initDatabaseDoc}); adding a second throws.
 *
 * @example
 * const status = addProperty(dbDoc, { name: 'Status', type: 'select', options: [{ name: 'Todo' }, { name: 'Done', color: 'green' }] });
 */
export function addProperty(
  db: Y.Doc,
  input: AddPropertyInput,
  options: MutationOptions = {},
): PropertyDefinition {
  const id = input.id ?? newId();
  if (!isValidId(id)) throw new ValidationError('Invalid property ID', [id]);
  if (!isPropertyType(input.type))
    throw new ValidationError('Invalid property type', [String(input.type)]);
  const config = computeTypeConfig(null, input.type, input);
  const initialOptions = (input.options ?? []).map((option, index) =>
    validated(
      selectOptionSchema,
      {
        id: option.id ?? newId(),
        name: normalizeName(option.name),
        color: option.color ?? nextOptionColor(index),
        order: 'a0',
      },
      'option',
    ),
  );
  if (initialOptions.length && input.type !== 'select' && input.type !== 'multiSelect') {
    throw new ValidationError('Only select and multi-select properties have options');
  }
  if (new Set(initialOptions.map((option) => option.id)).size !== initialOptions.length) {
    throw new ValidationError('Option IDs must be unique');
  }
  db.transact(() => {
    const schema = schemaOf(db);
    if (schema.has(id)) throw new InvalidOperationError(`Property "${id}" already exists`);
    if (input.type === 'title' && getTitleProperty(db)) {
      throw new InvalidOperationError('A database has exactly one title property');
    }
    const siblings = listProperties(db);
    const position = input.position ?? 'end';
    if (position !== 'end') positionToIndex(siblings, position);
    const order =
      position === 'end' ? orderAfterAll(siblings) : placeOrdered(schema, siblings, position);
    const map = new Y.Map<unknown>();
    map.set('id', id);
    map.set('name', normalizeName(input.name));
    map.set('type', input.type);
    map.set('order', order);
    if (input.description) map.set('description', input.description);
    for (const [key, value] of config) map.set(key, value);
    if (input.type === 'select' || input.type === 'multiSelect') {
      // Build the nested map before inserting: reading from a not-yet-inserted Y.Map returns nothing.
      const optionMap = new Y.Map<unknown>();
      const optionKeys = ordersBetween(null, null, initialOptions.length);
      initialOptions.forEach((option, index) => {
        optionMap.set(option.id, { ...option, order: optionKeys[index] ?? option.order });
      });
      map.set('options', optionMap);
    }
    schema.set(id, map);
  }, options.origin);
  const created = getProperty(db, id);
  if (!created) throw new InvalidOperationError('Failed to create property');
  return created;
}

/** Changes to a property. `description: null` removes the description. */
export interface PropertyPatch {
  name?: string;
  type?: PropertyType;
  description?: string | null;
  number?: Partial<NumberConfig>;
  date?: Partial<DateConfig>;
  relation?: Partial<RelationConfig>;
  formula?: FormulaConfig;
}

/**
 * Updates a property. Changing the type does **not** convert stored values: the databases
 * feature converts values first (in the same transaction), and readers treat values that do not
 * validate for the current type as empty. The title property's type cannot change.
 */
export function updateProperty(
  db: Y.Doc,
  id: string,
  patch: PropertyPatch,
  options: MutationOptions = {},
): PropertyDefinition {
  db.transact(() => {
    const map = propertyMap(db, id);
    const current = readProperty(id, map);
    if (!current) throw new NotFoundError('Property', id);
    const type = patch.type ?? current.type;
    if (!isPropertyType(type)) throw new ValidationError('Invalid property type', [String(type)]);
    if ((current.type === 'title') !== (type === 'title')) {
      throw new InvalidOperationError(
        'The title property cannot change type, and only it can be the title',
      );
    }
    const config = computeTypeConfig(map, type, patch, current);
    if (patch.name !== undefined) map.set('name', normalizeName(patch.name));
    if (patch.description === null) map.delete('description');
    else if (patch.description !== undefined) map.set('description', patch.description);
    if (type !== current.type) map.set('type', type);
    for (const [key, value] of config) map.set(key, value);
    ensureOptionsMap(map, type);
  }, options.origin);
  const updated = getProperty(db, id);
  if (!updated) throw new NotFoundError('Property', id);
  return updated;
}

/**
 * Deletes a property, its values in every row, and every reference to it in views (columns,
 * sorts, filters, grouping, summaries, calendar and card settings). The title property cannot be
 * deleted.
 */
export function deleteProperty(db: Y.Doc, id: string, options: MutationOptions = {}): void {
  db.transact(() => {
    const property = getProperty(db, id);
    if (!property) throw new NotFoundError('Property', id);
    if (property.type === 'title')
      throw new InvalidOperationError('The title property cannot be deleted');
    schemaOf(db).delete(id);
    rowsOf(db).forEach((row) => {
      asMap(asMap(row)?.get('values'))?.delete(id);
    });
    viewsOf(db).forEach((value, viewId) => {
      const map = asMap(value);
      const view = map ? readView(viewId, map) : null;
      if (!map || !view) return;
      if (view.properties.some((entry) => entry.propertyId === id)) {
        map.set(
          'properties',
          view.properties.filter((entry) => entry.propertyId !== id),
        );
      }
      if (view.sorts.some((sort) => sort.propertyId === id)) {
        map.set(
          'sorts',
          view.sorts.filter((sort) => sort.propertyId !== id),
        );
      }
      if (view.filter) {
        const pruned = removePropertyFromFilter(view.filter, id);
        if (JSON.stringify(pruned) !== JSON.stringify(view.filter)) map.set('filter', pruned);
      }
      if (view.group?.propertyId === id) map.set('group', null);
      if (id in view.table.summaries) {
        const summaries = { ...view.table.summaries };
        delete summaries[id];
        map.set('table', { ...view.table, summaries });
      }
      if (view.calendar.datePropertyId === id)
        map.set('calendar', { ...view.calendar, datePropertyId: null });
      for (const key of ['board', 'gallery'] as const) {
        const cover = view[key].cover;
        if (cover.kind === 'property' && cover.propertyId === id)
          map.set(key, { ...view[key], cover: { kind: 'none' } });
      }
    });
  }, options.origin);
}

function placeOrdered(
  map: Y.Map<unknown>,
  siblings: readonly { id: string; order: string }[],
  position: ListPosition,
): string {
  const { order, rekeyed } = orderForIndex(siblings, positionToIndex(siblings, position));
  for (const entry of rekeyed) asMap(map.get(entry.id))?.set('order', entry.order);
  return order;
}

/** Moves a property within the canonical column order. */
export function moveProperty(
  db: Y.Doc,
  id: string,
  position: ListPosition,
  options: MutationOptions = {},
): void {
  db.transact(() => {
    const map = propertyMap(db, id);
    const siblings = listProperties(db).filter((property) => property.id !== id);
    map.set(
      'order',
      position === 'end' ? orderAfterAll(siblings) : placeOrdered(schemaOf(db), siblings, position),
    );
  }, options.origin);
}

function optionsMap(db: Y.Doc, propertyId: string): Y.Map<unknown> {
  const map = propertyMap(db, propertyId);
  const property = readProperty(propertyId, map);
  if (property?.type !== 'select' && property?.type !== 'multiSelect') {
    throw new InvalidOperationError('Only select and multi-select properties have options');
  }
  let options = map.get('options');
  if (!(options instanceof Y.Map)) {
    options = new Y.Map<unknown>();
    map.set('options', options);
  }
  return options as Y.Map<unknown>;
}

/**
 * Finds an option by name (case-insensitive, trimmed). Use it for "create by typing" and imports,
 * so typing an existing name reuses the option.
 */
export function findSelectOption(
  property: PropertyDefinition,
  name: string,
): SelectOption | undefined {
  const needle = name.trim().toLocaleLowerCase();
  return property.options?.find((option) => option.name.trim().toLocaleLowerCase() === needle);
}

/** Adds a select option. Colors default to the next palette color. */
export function addSelectOption(
  db: Y.Doc,
  propertyId: string,
  input: { id?: string; name: string; color?: TagColor },
  options: MutationOptions = {},
): SelectOption {
  const id = input.id ?? newId();
  let created: SelectOption | undefined;
  db.transact(() => {
    const map = optionsMap(db, propertyId);
    if (map.has(id)) throw new InvalidOperationError(`Option "${id}" already exists`);
    const existing = readOptions(map);
    const option = validated(
      selectOptionSchema,
      {
        id,
        name: normalizeName(input.name),
        color: input.color ?? nextOptionColor(existing.length),
        order: orderAfterAll(existing),
      },
      'option',
    );
    map.set(id, option);
    created = option;
  }, options.origin);
  if (!created) throw new InvalidOperationError('Failed to create option');
  return created;
}

/** Renames or recolors a select option. */
export function updateSelectOption(
  db: Y.Doc,
  propertyId: string,
  optionId: string,
  patch: { name?: string; color?: TagColor },
  options: MutationOptions = {},
): void {
  db.transact(() => {
    const map = optionsMap(db, propertyId);
    const current = readOptions(map).find((option) => option.id === optionId);
    if (!current) throw new NotFoundError('Option', optionId);
    map.set(
      optionId,
      validated(
        selectOptionSchema,
        {
          ...current,
          ...(patch.name !== undefined ? { name: normalizeName(patch.name) } : {}),
          ...(patch.color ? { color: patch.color } : {}),
        },
        'option',
      ),
    );
  }, options.origin);
}

/** Deletes a select option and removes it from every row value and board grouping. */
export function deleteSelectOption(
  db: Y.Doc,
  propertyId: string,
  optionId: string,
  options: MutationOptions = {},
): void {
  db.transact(() => {
    const map = optionsMap(db, propertyId);
    if (!map.has(optionId)) throw new NotFoundError('Option', optionId);
    map.delete(optionId);
    rowsOf(db).forEach((row) => {
      const values = asMap(asMap(row)?.get('values'));
      const value = values?.get(propertyId);
      if (value === optionId) values?.delete(propertyId);
      else if (Array.isArray(value) && value.includes(optionId)) {
        values?.set(
          propertyId,
          value.filter((item) => item !== optionId),
        );
      }
    });
    viewsOf(db).forEach((value, viewId) => {
      const viewMap = asMap(value);
      const view = viewMap ? readView(viewId, viewMap) : null;
      if (!viewMap || !view?.group || view.group.propertyId !== propertyId) return;
      const strip = (list: string[]) => list.filter((key) => key !== optionId);
      viewMap.set('group', {
        ...view.group,
        order: strip(view.group.order),
        hidden: strip(view.group.hidden),
        collapsed: strip(view.group.collapsed),
      });
    });
  }, options.origin);
}

/** Moves a select option within its property's option list. */
export function moveSelectOption(
  db: Y.Doc,
  propertyId: string,
  optionId: string,
  position: ListPosition,
  options: MutationOptions = {},
): void {
  db.transact(() => {
    const map = optionsMap(db, propertyId);
    const all = readOptions(map);
    const current = all.find((option) => option.id === optionId);
    if (!current) throw new NotFoundError('Option', optionId);
    const siblings = all.filter((option) => option.id !== optionId);
    const { order, rekeyed } = orderForIndex(siblings, positionToIndex(siblings, position));
    for (const entry of rekeyed) {
      const sibling = siblings.find((option) => option.id === entry.id);
      if (sibling) map.set(entry.id, { ...sibling, order: entry.order });
    }
    map.set(optionId, { ...current, order });
  }, options.origin);
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/**
 * A row as stored in the database doc. `id` is the row page's ID: the title, icon, timestamps and
 * trash state live in that page's `PageMeta`; use {@link resolveRows} to join them.
 */
export interface DatabaseRow {
  id: string;
  /** Fractional index: manual order (used when a view has no sorts). */
  order: string;
  /** Stored values by property ID. Values may fail validation after type changes; treat those as empty. */
  values: Record<string, JsonValue>;
  /** When a value last changed (content edits update the page's `updatedAt` instead). */
  valuesUpdatedAt?: number;
  valuesUpdatedBy?: string;
}

/** @internal */
export function readRow(id: string, value: unknown): DatabaseRow | null {
  const map = asMap(value);
  if (!map) return null;
  const values: Record<string, JsonValue> = {};
  asMap(map.get('values'))?.forEach((item, key) => {
    if (isJsonValue(item)) values[key] = item;
  });
  const row: DatabaseRow = { id, order: str(map.get('order')) || 'a0', values };
  const updatedAt = map.get('valuesUpdatedAt');
  if (typeof updatedAt === 'number') row.valuesUpdatedAt = updatedAt;
  const updatedBy = str(map.get('valuesUpdatedBy'));
  if (updatedBy) row.valuesUpdatedBy = updatedBy;
  return row;
}

/** Lists rows in manual order. For 10,000 rows this is a few milliseconds; views should memoize. */
export function listRows(db: Y.Doc): DatabaseRow[] {
  const result: DatabaseRow[] = [];
  rowsOf(db).forEach((value, id) => {
    const row = readRow(id, value);
    if (row) result.push(row);
  });
  return result.sort(compareOrdered);
}

/** Returns one row, or undefined. */
export function getRow(db: Y.Doc, id: string): DatabaseRow | undefined {
  return readRow(id, rowsOf(db).get(id)) ?? undefined;
}

/** Number of rows (including rows whose page is in the trash). */
export function countRows(db: Y.Doc): number {
  return rowsOf(db).size;
}

function rowMap(db: Y.Doc, id: string): Y.Map<unknown> {
  const map = asMap(rowsOf(db).get(id));
  if (!map) throw new NotFoundError('Row', id);
  return map;
}

function checkValue(db: Y.Doc, propertyId: string, value: JsonValue): JsonValue {
  const property = getProperty(db, propertyId);
  if (!property) throw new NotFoundError('Property', propertyId);
  if (!isStoredPropertyType(property.type)) {
    throw new InvalidOperationError(
      `"${property.type}" values are not stored in rows (titles live in PageMeta; times and formulas are computed)`,
    );
  }
  const result = validatePropertyValue(property.type, value);
  if (!result.success)
    throw new ValidationError(`Invalid value for "${property.name}"`, [result.error]);
  if (property.type === 'select' || property.type === 'multiSelect') {
    const known = new Set(property.options?.map((option) => option.id));
    const ids = Array.isArray(value) ? value : [value];
    const unknown = ids.filter((item) => typeof item !== 'string' || !known.has(item));
    if (unknown.length)
      throw new ValidationError(`Unknown option for "${property.name}"`, unknown.map(String));
  }
  return value;
}

function writeValues(
  db: Y.Doc,
  map: Y.Map<unknown>,
  values: Record<string, JsonValue | null | undefined>,
  options: MutationOptions,
): void {
  // Validate every value before the first write (Yjs cannot roll back a half-applied transaction).
  const checked = Object.entries(values).map(
    ([propertyId, value]) =>
      [
        propertyId,
        value === null || value === undefined ? null : checkValue(db, propertyId, value),
      ] as const,
  );
  let valuesMap = map.get('values');
  if (!(valuesMap instanceof Y.Map)) {
    valuesMap = new Y.Map<unknown>();
    map.set('values', valuesMap);
  }
  const target = valuesMap as Y.Map<unknown>;
  for (const [propertyId, value] of checked) {
    if (value === null) target.delete(propertyId);
    else target.set(propertyId, value);
  }
  map.set('valuesUpdatedAt', options.now ?? Date.now());
  if (options.userId) map.set('valuesUpdatedBy', options.userId);
}

/** Input for {@link addRow}. */
export interface AddRowInput {
  /** The row page's ID. Create the PageMeta (parent = the database page) with the same ID. */
  id?: string;
  values?: Record<string, JsonValue | null>;
  /** Defaults to `'end'`. */
  position?: ListPosition;
}

/**
 * Adds a row entry to the database doc. The row's page (title, body) is a separate `PageMeta`
 * whose parent is the database page; `AppContext.workspace.addDatabaseRow` creates both.
 *
 * @example
 * addRow(dbDoc, { id: rowPage.id, values: { [statusId]: todoOptionId } });
 */
export function addRow(
  db: Y.Doc,
  input: AddRowInput = {},
  options: MutationOptions = {},
): DatabaseRow {
  const id = input.id ?? newId();
  if (!isValidId(id)) throw new ValidationError('Invalid row ID', [id]);
  db.transact(() => {
    const rows = rowsOf(db);
    if (rows.has(id)) throw new InvalidOperationError(`Row "${id}" already exists`);
    for (const [propertyId, value] of Object.entries(input.values ?? {})) {
      if (value !== null && value !== undefined) checkValue(db, propertyId, value);
    }
    const siblings = listRows(db);
    const position = input.position ?? 'end';
    if (position !== 'end') positionToIndex(siblings, position);
    const order =
      position === 'end' ? orderAfterAll(siblings) : placeOrdered(rows, siblings, position);
    const map = new Y.Map<unknown>();
    map.set('order', order);
    map.set('values', new Y.Map<unknown>());
    rows.set(id, map);
    writeValues(db, map, input.values ?? {}, options);
  }, options.origin);
  const row = getRow(db, id);
  if (!row) throw new InvalidOperationError('Failed to create row');
  return row;
}

/**
 * Sets one value (null clears it). Validates the value against the property type, and option IDs
 * against the property's options.
 *
 * @example
 * setRowValue(dbDoc, rowId, dueId, { start: '2026-10-01' });
 */
export function setRowValue(
  db: Y.Doc,
  rowId: string,
  propertyId: string,
  value: JsonValue | null,
  options: MutationOptions = {},
): void {
  setRowValues(db, rowId, { [propertyId]: value }, options);
}

/** Sets several values of one row in one transaction (null clears). */
export function setRowValues(
  db: Y.Doc,
  rowId: string,
  values: Record<string, JsonValue | null>,
  options: MutationOptions = {},
): void {
  db.transact(() => writeValues(db, rowMap(db, rowId), values, options), options.origin);
}

/**
 * Removes a row entry. The caller also trashes or deletes the row page
 * (`AppContext.workspace.trashPage` hides it from views without deleting this entry, so it can be restored).
 */
export function deleteRow(db: Y.Doc, rowId: string, options: MutationOptions = {}): void {
  db.transact(() => {
    rowMap(db, rowId);
    rowsOf(db).delete(rowId);
  }, options.origin);
}

/** Moves a row within the manual order. */
export function moveRow(
  db: Y.Doc,
  rowId: string,
  position: ListPosition,
  options: MutationOptions = {},
): void {
  db.transact(() => {
    const map = rowMap(db, rowId);
    const siblings = listRows(db).filter((row) => row.id !== rowId);
    map.set(
      'order',
      position === 'end' ? orderAfterAll(siblings) : placeOrdered(rowsOf(db), siblings, position),
    );
  }, options.origin);
}

/** A row joined with its page's metadata. */
export interface ResolvedRow extends DatabaseRow {
  title: string;
  icon?: string;
  createdAt: number;
  /** The later of the page's `updatedAt` and `valuesUpdatedAt`. */
  updatedAt: number;
  createdBy?: string;
  updatedBy?: string;
  /** True when the row page (or the database page) is in the trash. Views hide these rows. */
  trashed: boolean;
  /** True when no PageMeta exists for the row yet (it can arrive later through sync). */
  missingPage: boolean;
}

/**
 * Joins rows with their pages' metadata. Views should drop `trashed` rows.
 *
 * @example
 * const rows = resolveRows(listRows(dbDoc), pagesSnapshot).filter((row) => !row.trashed);
 */
export function resolveRows(
  rows: readonly DatabaseRow[],
  pages: Pick<PageIndex, 'get' | 'isTrashed'>,
): ResolvedRow[] {
  return rows.map((row) => {
    const page = pages.get(row.id);
    const resolved: ResolvedRow = {
      ...row,
      title: page?.title ?? '',
      createdAt: page?.createdAt ?? row.valuesUpdatedAt ?? 0,
      updatedAt: Math.max(page?.updatedAt ?? 0, row.valuesUpdatedAt ?? 0),
      trashed: page ? pages.isTrashed(row.id) : false,
      missingPage: !page,
    };
    if (page?.icon) resolved.icon = page.icon;
    if (page?.createdBy) resolved.createdBy = page.createdBy;
    const updatedBy =
      (row.valuesUpdatedAt ?? 0) > (page?.updatedAt ?? 0) ? row.valuesUpdatedBy : page?.updatedBy;
    if (updatedBy) resolved.updatedBy = updatedBy;
    return resolved;
  });
}

/**
 * Returns the value of a cell for any property type: the title for `title`, epoch milliseconds for
 * `createdTime`/`updatedTime`, the validated stored value for stored types, and null for empty or
 * invalid values and for `formula` (computed by the databases feature).
 */
export function getCellValue(row: ResolvedRow, property: PropertyDefinition): JsonValue {
  switch (property.type) {
    case 'title':
      return row.title;
    case 'createdTime':
      return row.createdAt;
    case 'updatedTime':
      return row.updatedAt;
    case 'formula':
      return null;
    default: {
      const value = row.values[property.id];
      if (value === undefined) return null;
      const result = validatePropertyValue(property.type, value);
      return result.success ? (result.value as JsonValue) : null;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

function parsePartial<T extends object>(
  schema: { partial(): { safeParse(v: unknown): { success: boolean; data?: Partial<T> } } },
  value: unknown,
  fallback: T,
): T {
  const result = schema.partial().safeParse(value);
  return result.success && result.data
    ? { ...fallback, ...result.data }
    : structuredClone(fallback);
}

/** @internal Reads a view tolerantly: invalid fields fall back to their defaults. */
export function readView(id: string, value: unknown): ViewConfig | null {
  const map = asMap(value);
  if (!map) return null;
  const type = viewFieldSchemas.type.safeParse(map.get('type'));
  const view = createDefaultView({
    id,
    name: str(map.get('name')) ?? '',
    type: type.success ? type.data : 'table',
    order: str(map.get('order')) || 'a0',
  });
  const filter = viewFieldSchemas.filter.safeParse(map.get('filter'));
  if (filter.success) view.filter = filter.data;
  const sorts = viewFieldSchemas.sorts.safeParse(map.get('sorts'));
  if (sorts.success) view.sorts = sorts.data;
  const group = viewFieldSchemas.group.safeParse(map.get('group'));
  if (group.success) view.group = group.data;
  const properties = viewFieldSchemas.properties.safeParse(map.get('properties'));
  if (properties.success) view.properties = properties.data;
  view.table = parsePartial<TableOptions>(
    viewFieldSchemas.table,
    map.get('table'),
    DEFAULT_TABLE_OPTIONS,
  );
  view.board = parsePartial<BoardOptions>(
    viewFieldSchemas.board,
    map.get('board'),
    DEFAULT_BOARD_OPTIONS,
  );
  view.calendar = parsePartial<CalendarOptions>(
    viewFieldSchemas.calendar,
    map.get('calendar'),
    DEFAULT_CALENDAR_OPTIONS,
  );
  view.gallery = parsePartial<GalleryOptions>(
    viewFieldSchemas.gallery,
    map.get('gallery'),
    DEFAULT_GALLERY_OPTIONS,
  );
  view.list = parsePartial<ListOptions>(
    viewFieldSchemas.list,
    map.get('list'),
    DEFAULT_LIST_OPTIONS,
  );
  return view;
}

/** Lists views in tab order. */
export function listViews(db: Y.Doc): ViewConfig[] {
  const result: ViewConfig[] = [];
  viewsOf(db).forEach((value, id) => {
    const view = readView(id, value);
    if (view) result.push(view);
  });
  return result.sort(compareOrdered);
}

/** Returns one view, or undefined. */
export function getView(db: Y.Doc, id: string): ViewConfig | undefined {
  return readView(id, viewsOf(db).get(id)) ?? undefined;
}

/** Changes to a view. Option blocks are merged into the current options. */
export interface ViewPatch {
  name?: string;
  type?: ViewType;
  filter?: ViewConfig['filter'];
  sorts?: ViewConfig['sorts'];
  group?: ViewConfig['group'];
  properties?: ViewConfig['properties'];
  table?: Partial<TableOptions>;
  board?: Partial<BoardOptions>;
  calendar?: Partial<CalendarOptions>;
  gallery?: Partial<GalleryOptions>;
  list?: Partial<ListOptions>;
}

function writeViewPatch(map: Y.Map<unknown>, current: ViewConfig, patch: ViewPatch): void {
  const issues: string[] = [];
  const writes: Array<[string, unknown]> = [];
  const set = (field: keyof typeof viewFieldSchemas, value: unknown) => {
    const result = viewFieldSchemas[field].safeParse(value);
    if (result.success) writes.push([field, result.data]);
    else issues.push(`${field}: ${result.error.issues.map((issue) => issue.message).join(', ')}`);
  };
  if (patch.name !== undefined) set('name', normalizeName(patch.name));
  if (patch.type !== undefined) set('type', patch.type);
  if (patch.filter !== undefined) set('filter', patch.filter);
  if (patch.sorts !== undefined) set('sorts', patch.sorts);
  if (patch.group !== undefined) set('group', patch.group);
  if (patch.properties !== undefined) set('properties', patch.properties);
  for (const block of ['table', 'board', 'calendar', 'gallery', 'list'] as const) {
    const value = patch[block];
    if (value !== undefined) set(block, { ...current[block], ...value });
  }
  // Validate everything first: a thrown error must leave the view untouched.
  if (issues.length) throw new ValidationError('Invalid view configuration', issues);
  for (const [field, value] of writes) map.set(field, value);
}

/** Input for {@link addView}. */
export interface AddViewInput extends ViewPatch {
  id?: string;
  name: string;
  type: ViewType;
  /** Defaults to `'end'`. */
  position?: ListPosition;
}

/**
 * Adds a view.
 *
 * @example
 * const board = addView(dbDoc, { name: t('databases:view.board'), type: 'board', group: { propertyId: statusId, order: [], hidden: [], collapsed: [], hideEmptyGroups: false, dateBucket: 'month' } });
 */
export function addView(db: Y.Doc, input: AddViewInput, options: MutationOptions = {}): ViewConfig {
  const id = input.id ?? newId();
  if (!isValidId(id)) throw new ValidationError('Invalid view ID', [id]);
  db.transact(() => {
    const views = viewsOf(db);
    if (views.has(id)) throw new InvalidOperationError(`View "${id}" already exists`);
    const siblings = listViews(db);
    const position = input.position ?? 'end';
    if (position !== 'end') positionToIndex(siblings, position);
    const base = createDefaultView({
      id,
      name: normalizeName(input.name),
      type: input.type,
      order: 'a0',
    });
    const map = new Y.Map<unknown>();
    for (const [field, value] of Object.entries(base)) map.set(field, value);
    const { id: _id, position: _position, ...patch } = input;
    // Validates before writing; the map is not in the doc yet, so a failure changes nothing.
    writeViewPatch(map, base, patch);
    map.set(
      'order',
      position === 'end' ? orderAfterAll(siblings) : placeOrdered(views, siblings, position),
    );
    views.set(id, map);
  }, options.origin);
  const view = getView(db, id);
  if (!view) throw new InvalidOperationError('Failed to create view');
  return view;
}

/** Updates a view (validated; invalid patches throw {@link ValidationError} and change nothing). */
export function updateView(
  db: Y.Doc,
  id: string,
  patch: ViewPatch,
  options: MutationOptions = {},
): ViewConfig {
  db.transact(() => {
    const map = asMap(viewsOf(db).get(id));
    const current = map ? readView(id, map) : null;
    if (!map || !current) throw new NotFoundError('View', id);
    writeViewPatch(map, current, patch);
  }, options.origin);
  const view = getView(db, id);
  if (!view) throw new NotFoundError('View', id);
  return view;
}

/** Deletes a view. The UI keeps at least one view per database. */
export function deleteView(db: Y.Doc, id: string, options: MutationOptions = {}): void {
  db.transact(() => {
    if (!viewsOf(db).has(id)) throw new NotFoundError('View', id);
    viewsOf(db).delete(id);
  }, options.origin);
}

/** Duplicates a view right after the original. */
export function duplicateView(
  db: Y.Doc,
  id: string,
  input: { id?: string; name?: string } = {},
  options: MutationOptions = {},
): ViewConfig {
  const source = getView(db, id);
  if (!source) throw new NotFoundError('View', id);
  const { id: _id, order: _order, ...config } = structuredClone(source);
  const copy: AddViewInput = {
    ...config,
    name: input.name ?? source.name,
    position: { after: id },
  };
  if (input.id) copy.id = input.id;
  return addView(db, copy, options);
}

/** Moves a view (tab) to a new position. */
export function moveView(
  db: Y.Doc,
  id: string,
  position: ListPosition,
  options: MutationOptions = {},
): void {
  db.transact(() => {
    const map = asMap(viewsOf(db).get(id));
    if (!map) throw new NotFoundError('View', id);
    const siblings = listViews(db).filter((view) => view.id !== id);
    map.set(
      'order',
      position === 'end' ? orderAfterAll(siblings) : placeOrdered(viewsOf(db), siblings, position),
    );
  }, options.origin);
}

// ---------------------------------------------------------------------------------------------
// Initialization and observation
// ---------------------------------------------------------------------------------------------

/** Names used when initializing a database; pass translated strings. */
export interface InitDatabaseInput {
  titlePropertyName: string;
  viewName: string;
  viewType?: ViewType;
  now?: number;
}

/**
 * Initializes a new database doc: data-model version, a title property and one view. Idempotent:
 * an already initialized doc is left as is. Always await the doc's `whenLoaded` first, or a new
 * title property could be created next to an existing one that has not loaded yet.
 *
 * @example
 * const handle = await ctx.loadDatabaseDoc(dbId);
 * const { titlePropertyId, viewId } = initDatabaseDoc(handle.doc, { titlePropertyName: t('name'), viewName: t('table') });
 */
export function initDatabaseDoc(
  db: Y.Doc,
  input: InitDatabaseInput,
  options: MutationOptions = {},
): { titlePropertyId: string; viewId: string } {
  let result: { titlePropertyId: string; viewId: string } | undefined;
  db.transact(() => {
    const meta = metaOf(db);
    if (!meta.has('schemaVersion')) {
      meta.set('schemaVersion', DATA_MODEL_VERSION);
      meta.set('createdAt', input.now ?? options.now ?? Date.now());
    }
    const title =
      getTitleProperty(db) ?? addProperty(db, { name: input.titlePropertyName, type: 'title' });
    const view =
      listViews(db)[0] ?? addView(db, { name: input.viewName, type: input.viewType ?? 'table' });
    result = { titlePropertyId: title.id, viewId: view.id };
  }, options.origin);
  if (!result) throw new InvalidOperationError('Failed to initialize database');
  return result;
}

/** What changed in a database doc in one transaction. */
export interface DatabaseChange {
  /** Properties or options changed. */
  schema: boolean;
  /** IDs of views that were added, changed or removed. */
  views: string[];
  rows: { added: string[]; updated: string[]; removed: string[] };
  meta: boolean;
  local: boolean;
  origin: unknown;
}

/**
 * Observes a database doc. The listener runs once per transaction that touched it.
 *
 * @example
 * const stop = observeDatabase(dbDoc, (change) => { if (change.schema || change.rows.updated.length) recompute(); });
 */
export function observeDatabase(db: Y.Doc, listener: (change: DatabaseChange) => void): () => void {
  const schema = schemaOf(db);
  const views = viewsOf(db);
  const rows = rowsOf(db);
  const meta = metaOf(db);
  let pending: DatabaseChange | null = null;
  const start = (transaction: Y.Transaction): DatabaseChange => {
    pending ??= {
      schema: false,
      views: [],
      rows: { added: [], updated: [], removed: [] },
      meta: false,
      local: transaction.local,
      origin: transaction.origin,
    };
    return pending;
  };
  const onSchema = (
    _events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
    transaction: Y.Transaction,
  ) => {
    start(transaction).schema = true;
  };
  const onMeta = (
    _events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
    transaction: Y.Transaction,
  ) => {
    start(transaction).meta = true;
  };
  const onViews = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>,
    transaction: Y.Transaction,
  ) => {
    const change = start(transaction);
    const ids = new Set(change.views);
    for (const event of events) {
      if (event.target === views)
        for (const key of (event as Y.YMapEvent<unknown>).keysChanged) ids.add(key);
      else if (typeof event.path[0] === 'string') ids.add(event.path[0]);
    }
    change.views = [...ids];
  };
  const onRows = (events: Array<Y.YEvent<Y.AbstractType<unknown>>>, transaction: Y.Transaction) => {
    const change = start(transaction);
    const added = new Set(change.rows.added);
    const updated = new Set(change.rows.updated);
    const removed = new Set(change.rows.removed);
    for (const event of events) {
      if (event.target === rows) {
        (event as Y.YMapEvent<unknown>).changes.keys.forEach((info, key) => {
          if (info.action === 'add') added.add(key);
          else if (info.action === 'delete') removed.add(key);
          else updated.add(key);
        });
      } else if (typeof event.path[0] === 'string') {
        updated.add(event.path[0]);
      }
    }
    for (const id of added) updated.delete(id);
    for (const id of removed) updated.delete(id);
    change.rows = { added: [...added], updated: [...updated], removed: [...removed] };
  };
  const flush = () => {
    const change = pending;
    pending = null;
    if (change) listener(change);
  };
  schema.observeDeep(onSchema);
  views.observeDeep(onViews);
  rows.observeDeep(onRows);
  meta.observeDeep(onMeta);
  db.on('afterTransaction', flush);
  return () => {
    schema.unobserveDeep(onSchema);
    views.unobserveDeep(onViews);
    rows.unobserveDeep(onRows);
    meta.unobserveDeep(onMeta);
    db.off('afterTransaction', flush);
  };
}
