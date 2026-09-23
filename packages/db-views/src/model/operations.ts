import {
  InvalidOperationError,
  addProperty,
  addSelectOption,
  addView,
  deleteProperty,
  deleteSelectOption,
  deleteView,
  findSelectOption,
  getDatabaseMeta,
  getPageProps,
  getProperty,
  getRow,
  getView,
  isDocEmpty,
  isStoredPropertyType,
  listProperties,
  listRows,
  listViews,
  readDocJSON,
  resolveViewProperties,
  setPageProp,
  setPageProps,
  setRowValue,
  setRowValues,
  updateProperty,
  updateView,
  writeDocJSON,
  type AddViewInput,
  type AppContext,
  type JsonValue,
  type ListPosition,
  type PageMeta,
  type PropertyDefinition,
  type PropertyType,
  type SelectOption,
  type TagColor,
  type ViewConfig,
  type ViewPatch,
  type ViewPropertyConfig,
  type ViewType,
} from '@tessera/core';
import type * as Y from 'yjs';
import { t } from '../i18n';
import { isValidStoredValue } from '../query/cells';
import { planTypeChange } from '../query/convert';
import { parseCellText } from '../query/parse';
import type { QueryContext, QueryRow } from '../query/types';
import { addRowsInBulk } from './bulk';
import { makeTwoWay, relationIds, setRelationValue, unlinkTwoWay } from './relations';
import { runUndoable, type UndoHandle } from './undo';

/** An open database: its page ID and its (loaded) database doc. */
export interface DatabaseRef {
  id: string;
  doc: Y.Doc;
}

type Ctx = Pick<AppContext, 'workspace' | 'loadDatabaseDoc' | 'loadPageDoc' | 'currentUser'>;

const mutation = (ctx: Pick<AppContext, 'currentUser'>) => ({ userId: ctx.currentUser.id });

// ---------------------------------------------------------------------------------------------
// Databases
// ---------------------------------------------------------------------------------------------

/** Input for {@link createDatabase}. */
export interface CreateDatabaseOptions {
  title?: string;
  parentId?: string | null;
  icon?: string;
  position?: ListPosition;
  viewType?: ViewType;
  /** Full-page databases open full width (a page prop the shell applies). */
  fullWidth?: boolean;
}

/**
 * Creates a database page with a title property and a table view, named in the user's language.
 *
 * @example
 * const { page } = await createDatabase(ctx, { title: 'Reading list', fullWidth: true });
 */
export async function createDatabase(
  ctx: Pick<AppContext, 'workspace' | 'loadPageDoc'>,
  options: CreateDatabaseOptions = {},
): Promise<{ page: PageMeta; titlePropertyId: string; viewId: string }> {
  const input: Parameters<AppContext['workspace']['createDatabase']>[0] = {
    title: options.title ?? '',
    parentId: options.parentId ?? null,
    titlePropertyName: t('defaultTitleProperty'),
    viewName: t('viewTable'),
  };
  if (options.icon) input.icon = options.icon;
  if (options.position) input.position = options.position;
  if (options.viewType) input.viewType = options.viewType;
  const created = await ctx.workspace.createDatabase(input);
  if (options.fullWidth) {
    const handle = await ctx.loadPageDoc(created.page.id);
    try {
      setPageProp(handle.doc, 'fullWidth', true);
    } finally {
      handle.release();
    }
  }
  return created;
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

/** Input for {@link addRow}. */
export interface AddRowOptions {
  title?: string;
  values?: Record<string, JsonValue | null>;
  position?: ListPosition;
  /** Copy the row template (when the database has one). Default true. */
  useTemplate?: boolean;
}

/** The row template page, when it exists and is not in the trash. */
export function templatePageOf(ctx: Pick<AppContext, 'workspace'>, db: Y.Doc): PageMeta | null {
  const id = getDatabaseMeta(db).rowTemplateId;
  if (!id) return null;
  const snapshot = ctx.workspace.pages.getSnapshot();
  const page = snapshot.get(id);
  return page && !snapshot.isTrashed(id) ? page : null;
}

/** Copies a page's content and props into another page (row templates, duplicates). */
async function copyPageContent(
  ctx: Pick<AppContext, 'loadPageDoc'>,
  fromId: string,
  toId: string,
): Promise<void> {
  const [source, target] = await Promise.all([ctx.loadPageDoc(fromId), ctx.loadPageDoc(toId)]);
  try {
    const content = readDocJSON(source.doc);
    const props = getPageProps(source.doc);
    if (isDocEmpty(content) && Object.keys(props).length === 0) return;
    target.doc.transact(() => {
      writeDocJSON(target.doc, content);
      setPageProps(target.doc, props);
    });
  } finally {
    source.release();
    target.release();
  }
}

/**
 * Adds a row (its page and its entry) and, when the database has a row template, copies the
 * template's content, props and icon into it.
 */
export async function addRow(
  ctx: Ctx,
  ref: DatabaseRef,
  options: AddRowOptions = {},
): Promise<PageMeta> {
  const template = options.useTemplate === false ? null : templatePageOf(ctx, ref.doc);
  const input: Parameters<AppContext['workspace']['addDatabaseRow']>[1] = {};
  if (options.title !== undefined) input.title = options.title;
  if (options.values) input.values = options.values;
  if (options.position) input.position = options.position;
  if (template?.icon) input.icon = template.icon;
  if (template && !input.title && template.title) input.title = template.title;
  const page = await ctx.workspace.addDatabaseRow(ref.id, input);
  if (template) await copyPageContent(ctx, template.id, page.id);
  return page;
}

/** Only the stored values that are valid for the database's current schema. */
function validValues(
  values: Readonly<Record<string, JsonValue>>,
  properties: readonly PropertyDefinition[],
): Record<string, JsonValue> {
  const result: Record<string, JsonValue> = {};
  for (const property of properties) {
    const value = values[property.id];
    if (value === undefined || !isStoredPropertyType(property.type)) continue;
    if (!isValidStoredValue(property.type, value)) continue;
    if (property.type === 'select' || property.type === 'multiSelect') {
      const known = new Set(property.options?.map((option) => option.id));
      const ids = Array.isArray(value) ? value : [value];
      if (!ids.every((id) => typeof id === 'string' && known.has(id))) continue;
    }
    result[property.id] = value;
  }
  return result;
}

/**
 * Duplicates rows right after the last of them: title, icon, values (two-way relations included)
 * and page content. Returns the new row IDs.
 */
export async function duplicateRows(
  ctx: Ctx,
  ref: DatabaseRef,
  rowIds: readonly string[],
): Promise<string[]> {
  const properties = listProperties(ref.doc);
  const created: string[] = [];
  let after = rowIds[rowIds.length - 1] ?? null;
  for (const rowId of rowIds) {
    const row = getRow(ref.doc, rowId);
    const page = ctx.workspace.getPage(rowId);
    if (!row || !page) continue;
    const values = validValues(row.values, properties);
    const [id] = addRowsInBulk(
      ctx,
      ref.doc,
      ref.id,
      [
        {
          title: page.title,
          ...(page.icon ? { icon: page.icon } : {}),
          values,
        },
      ],
      { after },
    );
    if (!id) continue;
    after = id;
    created.push(id);
    // Two-way relations: the copy links back from the target rows too.
    for (const property of properties) {
      if (property.type !== 'relation' || !property.relation?.backPropertyId) continue;
      const ids = relationIds(values[property.id]);
      if (ids.length > 0) await setRelationValue(ctx, ref.doc, id, property, ids);
    }
    await copyPageContent(ctx, rowId, id);
  }
  return created;
}

/** Moves rows to the trash (their values stay, so Undo or the Trash view brings them back). */
export function trashRows(
  ctx: Pick<AppContext, 'workspace'>,
  rowIds: readonly string[],
): () => void {
  const trashed: string[] = [];
  ctx.workspace.doc.transact(() => {
    for (const id of rowIds) {
      if (!ctx.workspace.getPage(id)) continue;
      ctx.workspace.trashPage(id);
      trashed.push(id);
    }
  });
  return () =>
    ctx.workspace.doc.transact(() => {
      for (const id of trashed) {
        const page = ctx.workspace.getPage(id);
        if (page?.trashedAt !== undefined) ctx.workspace.restorePage(id);
      }
    });
}

// ---------------------------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------------------------

/**
 * Writes one cell: renames the row page for the title, keeps two-way relations in step, and
 * validates everything else through core. Computed columns cannot be written.
 */
export async function setCell(
  ctx: Ctx,
  ref: DatabaseRef,
  rowId: string,
  property: PropertyDefinition,
  value: JsonValue | null,
): Promise<void> {
  switch (property.type) {
    case 'title':
      ctx.workspace.renamePage(rowId, typeof value === 'string' ? value : '');
      return;
    case 'relation':
      await setRelationValue(ctx, ref.doc, rowId, property, relationIds(value ?? undefined));
      return;
    case 'createdTime':
    case 'updatedTime':
    case 'formula':
      throw new InvalidOperationError(`"${property.type}" values are computed`);
    default:
      setRowValue(ref.doc, rowId, property.id, value, mutation(ctx));
  }
}

/** Finds an option by name (case-insensitive) or creates it. */
export function ensureOption(
  db: Y.Doc,
  propertyId: string,
  name: string,
  color?: TagColor,
): SelectOption {
  const property = getProperty(db, propertyId);
  const existing = property ? findSelectOption(property, name) : undefined;
  if (existing) return existing;
  return addSelectOption(db, propertyId, color ? { name, color } : { name });
}

/** One pasted or imported cell. */
export interface TextCell {
  rowId: string;
  property: PropertyDefinition;
  text: string;
}

/**
 * Writes cells from text (pasting ranges, fill): parses each for its property type, creates
 * missing select options, resolves relation titles among the allowed pages, renames titles, and
 * writes everything per database in one transaction. Returns how many cells could not be parsed.
 */
export async function setCellsFromText(
  ctx: Ctx,
  ref: DatabaseRef,
  cells: readonly TextCell[],
  queryCtx: Pick<QueryContext, 'timeZone'>,
): Promise<{ written: number; skipped: number }> {
  let skipped = 0;
  let written = 0;
  const titles: Array<[string, string]> = [];
  const relations: Array<{ rowId: string; property: PropertyDefinition; ids: string[] }> = [];
  const values = new Map<string, Record<string, JsonValue | null>>();
  const setValue = (rowId: string, propertyId: string, value: JsonValue | null) => {
    const row = values.get(rowId) ?? {};
    row[propertyId] = value;
    values.set(rowId, row);
  };
  const snapshot = ctx.workspace.pages.getSnapshot();
  ref.doc.transact(() => {
    for (const cell of cells) {
      const parsed = parseCellText(cell.text, cell.property, queryCtx);
      switch (parsed.kind) {
        case 'title':
          titles.push([cell.rowId, parsed.title]);
          break;
        case 'value':
          setValue(cell.rowId, cell.property.id, parsed.value);
          break;
        case 'options': {
          const ids = parsed.names.map((name) => ensureOption(ref.doc, cell.property.id, name).id);
          setValue(
            cell.rowId,
            cell.property.id,
            cell.property.type === 'select' ? (ids[0] ?? null) : ids,
          );
          break;
        }
        case 'pages': {
          const target = cell.property.relation?.targetDatabaseId ?? null;
          const candidates = target
            ? snapshot.children(target, { includeRows: true })
            : snapshot.all().filter((page) => !snapshot.isTrashed(page.id));
          const ids: string[] = [];
          for (const title of parsed.titles) {
            const match = candidates.find(
              (page) => page.title.trim().toLowerCase() === title.trim().toLowerCase(),
            );
            if (match) ids.push(match.id);
          }
          if (ids.length === 0 && parsed.titles.length > 0) skipped += 1;
          else relations.push({ rowId: cell.rowId, property: cell.property, ids });
          break;
        }
        default:
          skipped += 1;
      }
    }
    for (const [rowId, rowValues] of values) {
      if (!getRow(ref.doc, rowId)) continue;
      setRowValues(ref.doc, rowId, rowValues, mutation(ctx));
      written += Object.keys(rowValues).length;
    }
  });
  if (titles.length > 0) {
    ctx.workspace.doc.transact(() => {
      for (const [rowId, title] of titles) ctx.workspace.renamePage(rowId, title);
    });
    written += titles.length;
  }
  for (const { rowId, property, ids } of relations) {
    await setRelationValue(ctx, ref.doc, rowId, property, ids);
    written += 1;
  }
  return { written, skipped };
}

// ---------------------------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------------------------

/** A property name that is not taken yet (`Status`, `Status 2`, …). */
export function uniquePropertyName(db: Y.Doc, base: string): string {
  const taken = new Set(listProperties(db).map((property) => property.name.trim().toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** The view's column list made explicit: every property, in the order the view shows them. */
export function materializeViewProperties(
  properties: readonly PropertyDefinition[],
  view: Pick<ViewConfig, 'type' | 'properties'>,
): ViewPropertyConfig[] {
  return resolveViewProperties(properties, view).map((entry) => {
    const config: ViewPropertyConfig = { propertyId: entry.property.id, visible: entry.visible };
    if (entry.width !== undefined) config.width = entry.width;
    return config;
  });
}

/** Input for {@link addDatabaseProperty}. */
export interface NewPropertyInput {
  type: PropertyType;
  name?: string;
  /** Show the new column at this index of the view (table views: next to a column). */
  view?: { id: string; index: number };
  relationTarget?: string | null;
}

/** Adds a property (named after its type when no name is given), visible in the given view. */
export function addDatabaseProperty(ref: DatabaseRef, input: NewPropertyInput): PropertyDefinition {
  let created: PropertyDefinition | undefined;
  ref.doc.transact(() => {
    const property = addProperty(ref.doc, {
      name: uniquePropertyName(ref.doc, input.name?.trim() || t(`type_${input.type}`)),
      type: input.type,
      ...(input.type === 'relation'
        ? { relation: { targetDatabaseId: input.relationTarget ?? null } }
        : {}),
    });
    created = property;
    if (input.view) {
      const view = getView(ref.doc, input.view.id);
      if (view) {
        const list = materializeViewProperties(listProperties(ref.doc), view).filter(
          (entry) => entry.propertyId !== property.id,
        );
        const index = Math.max(0, Math.min(input.view.index, list.length));
        list.splice(index, 0, { propertyId: property.id, visible: true });
        updateView(ref.doc, view.id, { properties: list });
      }
    }
  });
  if (!created) throw new InvalidOperationError('Failed to add the property');
  return created;
}

/** Copies a property (config and options) with its values, right after it. */
export function duplicateProperty(
  ref: DatabaseRef,
  propertyId: string,
  name: string,
): PropertyDefinition {
  const source = getProperty(ref.doc, propertyId);
  if (!source || source.type === 'title')
    throw new InvalidOperationError('Cannot duplicate this property');
  let copy: PropertyDefinition | undefined;
  ref.doc.transact(() => {
    const input: Parameters<typeof addProperty>[1] = {
      name: uniquePropertyName(ref.doc, name),
      type: source.type,
      position: { after: source.id },
    };
    if (source.number) input.number = source.number;
    if (source.date) input.date = source.date;
    if (source.relation) input.relation = { ...source.relation, backPropertyId: null };
    if (source.options)
      input.options = source.options.map(({ name: optionName, color }) => ({
        name: optionName,
        color,
      }));
    const created = addProperty(ref.doc, input);
    copy = created;
    const optionMap = new Map(
      (source.options ?? []).map((option, index) => [option.id, created.options?.[index]?.id]),
    );
    for (const row of listRows(ref.doc)) {
      const value = row.values[source.id];
      if (value === undefined) continue;
      let next: JsonValue | null = value;
      if (source.type === 'select')
        next = typeof value === 'string' ? (optionMap.get(value) ?? null) : null;
      if (source.type === 'multiSelect' && Array.isArray(value))
        next = value
          .map((id) => (typeof id === 'string' ? optionMap.get(id) : undefined))
          .filter((id): id is string => !!id);
      if (
        next === null ||
        !isStoredPropertyType(source.type) ||
        !isValidStoredValue(source.type, next)
      )
        continue;
      setRowValue(ref.doc, row.id, created.id, next);
    }
  });
  if (!copy) throw new InvalidOperationError('Failed to duplicate the property');
  return copy;
}

/**
 * Changes a property's type, converting values that convert (`42` ↔ `"42"`, option IDs ↔ names,
 * dates ↔ text) and leaving the rest in place so switching back restores them. Undoable.
 */
export async function changePropertyType(
  ctx: Ctx,
  ref: DatabaseRef,
  rows: readonly QueryRow[],
  propertyId: string,
  type: PropertyType,
  queryCtx: QueryContext,
): Promise<UndoHandle | null> {
  const property = getProperty(ref.doc, propertyId);
  if (!property || property.type === type || property.type === 'title' || type === 'title')
    return null;
  if (property.type === 'relation' && property.relation?.backPropertyId) {
    await unlinkTwoWay(ctx, ref.doc, property);
  }
  const current = getProperty(ref.doc, propertyId) ?? property;
  const plan = planTypeChange(rows, current, type, queryCtx);
  return runUndoable(ref.doc, () => {
    updateProperty(ref.doc, propertyId, type === 'relation' ? { type, relation: {} } : { type });
    for (const { rowId, change } of plan.updates) {
      if (!getRow(ref.doc, rowId)) continue;
      if (change.kind === 'set') {
        setRowValue(ref.doc, rowId, propertyId, change.value, mutation(ctx));
      } else {
        const ids = change.names.map((name) => ensureOption(ref.doc, propertyId, name).id);
        setRowValue(
          ref.doc,
          rowId,
          propertyId,
          type === 'select' ? (ids[0] ?? null) : ids,
          mutation(ctx),
        );
      }
    }
  });
}

/** Deletes a property with Undo (two-way relations become one-way on the other side first). */
export async function deletePropertyUndoable(
  ctx: Ctx,
  ref: DatabaseRef,
  propertyId: string,
): Promise<UndoHandle> {
  const property = getProperty(ref.doc, propertyId);
  if (!property) throw new InvalidOperationError('This property no longer exists');
  if (property.type === 'relation' && property.relation?.backPropertyId) {
    await unlinkTwoWay(ctx, ref.doc, property);
  }
  return runUndoable(ref.doc, () => deleteProperty(ref.doc, propertyId));
}

/** Deletes a select option with Undo (rows that had it lose it). */
export function deleteOptionUndoable(
  ref: DatabaseRef,
  propertyId: string,
  optionId: string,
): UndoHandle {
  return runUndoable(ref.doc, () => deleteSelectOption(ref.doc, propertyId, optionId));
}

/** Makes a relation two-way, naming the back property after this database. */
export async function enableTwoWay(
  ctx: Ctx,
  ref: DatabaseRef,
  propertyId: string,
): Promise<PropertyDefinition | null> {
  const title = ctx.workspace.getPage(ref.id)?.title.trim() || t('untitledDatabase');
  return makeTwoWay(ctx, ref.doc, ref.id, propertyId, t('backRelationName', { database: title }));
}

export { unlinkTwoWay };

// ---------------------------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------------------------

const VIEW_NAME_KEYS = {
  table: 'viewTable',
  board: 'viewBoard',
  calendar: 'viewCalendar',
  gallery: 'viewGallery',
  list: 'viewList',
} as const;

/** The translated name of a view type. */
export function viewTypeName(type: ViewType): string {
  return t(VIEW_NAME_KEYS[type]);
}

/** Makes sure a board has a property to group by: the first select-like one, or a new Status. */
function boardGroupProperty(db: Y.Doc): PropertyDefinition {
  const existing = listProperties(db).find(
    (property) => property.type === 'select' || property.type === 'multiSelect',
  );
  if (existing) return existing;
  return addProperty(db, {
    name: uniquePropertyName(db, t('defaultStatusProperty')),
    type: 'select',
    options: [
      { name: t('statusNotStarted'), color: 'gray' },
      { name: t('statusInProgress'), color: 'blue' },
      { name: t('statusDone'), color: 'green' },
    ],
  });
}

/** Makes sure a calendar has a date property: the first one, or a new "Date". */
function calendarDateProperty(db: Y.Doc): PropertyDefinition {
  const existing = listProperties(db).find((property) => property.type === 'date');
  if (existing) return existing;
  return addProperty(db, { name: uniquePropertyName(db, t('defaultDateProperty')), type: 'date' });
}

/** Everything a view of `type` needs to work (group for boards, a date for calendars). */
export function viewSetup(db: Y.Doc, type: ViewType, current?: ViewConfig): ViewPatch {
  if (type === 'board') {
    const valid = current?.group && getProperty(db, current.group.propertyId);
    const groupable = valid && ['select', 'multiSelect', 'checkbox'].includes(valid.type);
    if (groupable) return {};
    const property = boardGroupProperty(db);
    return {
      group: {
        propertyId: property.id,
        order: [],
        hidden: [],
        collapsed: [],
        hideEmptyGroups: false,
        dateBucket: 'month',
      },
    };
  }
  if (type === 'calendar') {
    const valid =
      current?.calendar.datePropertyId && getProperty(db, current.calendar.datePropertyId);
    if (valid && valid.type === 'date') return {};
    return { calendar: { datePropertyId: calendarDateProperty(db).id } };
  }
  return {};
}

/** Adds a view of a type, set up so it works right away. */
export function addDatabaseView(ref: DatabaseRef, type: ViewType, name?: string): ViewConfig {
  let created: ViewConfig | undefined;
  ref.doc.transact(() => {
    const input: AddViewInput = {
      name: name ?? viewTypeName(type),
      type,
      ...viewSetup(ref.doc, type),
    };
    created = addView(ref.doc, input);
  });
  if (!created) throw new InvalidOperationError('Failed to add the view');
  return created;
}

/** Changes a view's layout, setting up what the new layout needs. */
export function changeViewType(ref: DatabaseRef, viewId: string, type: ViewType): void {
  ref.doc.transact(() => {
    const view = getView(ref.doc, viewId);
    if (!view) return;
    updateView(ref.doc, viewId, { type, ...viewSetup(ref.doc, type, view) });
  });
}

/** Deletes a view with Undo. The last view cannot be deleted. */
export function deleteViewUndoable(ref: DatabaseRef, viewId: string): UndoHandle {
  if (listViews(ref.doc).length <= 1) throw new InvalidOperationError(t('cannotDeleteLastView'));
  return runUndoable(ref.doc, () => deleteView(ref.doc, viewId));
}

/** Shows or hides a property in a view. */
export function setPropertyVisible(
  ref: DatabaseRef,
  viewId: string,
  propertyId: string,
  visible: boolean,
): void {
  ref.doc.transact(() => {
    const view = getView(ref.doc, viewId);
    if (!view) return;
    const list = materializeViewProperties(listProperties(ref.doc), view).map((entry) =>
      entry.propertyId === propertyId ? { ...entry, visible } : entry,
    );
    updateView(ref.doc, viewId, { properties: list });
  });
}

/** Shows or hides every property except the title in a view. */
export function setAllPropertiesVisible(ref: DatabaseRef, viewId: string, visible: boolean): void {
  ref.doc.transact(() => {
    const view = getView(ref.doc, viewId);
    if (!view) return;
    const list = materializeViewProperties(listProperties(ref.doc), view).map((entry) => ({
      ...entry,
      visible,
    }));
    updateView(ref.doc, viewId, { properties: list });
  });
}

/** Moves a property to `index` in a view's column order. */
export function movePropertyInView(
  ref: DatabaseRef,
  viewId: string,
  propertyId: string,
  index: number,
): void {
  ref.doc.transact(() => {
    const view = getView(ref.doc, viewId);
    if (!view) return;
    const list = materializeViewProperties(listProperties(ref.doc), view);
    const from = list.findIndex((entry) => entry.propertyId === propertyId);
    if (from < 0) return;
    const [entry] = list.splice(from, 1);
    if (!entry) return;
    list.splice(Math.max(0, Math.min(index, list.length)), 0, entry);
    updateView(ref.doc, viewId, { properties: list });
  });
}

/** Sets a column's width in a view (40 to 2000 CSS pixels). */
export function setColumnWidth(
  ref: DatabaseRef,
  viewId: string,
  propertyId: string,
  width: number,
): void {
  ref.doc.transact(() => {
    const view = getView(ref.doc, viewId);
    if (!view) return;
    const clamped = Math.round(Math.max(40, Math.min(2000, width)));
    const list = materializeViewProperties(listProperties(ref.doc), view).map((entry) =>
      entry.propertyId === propertyId ? { ...entry, width: clamped } : entry,
    );
    updateView(ref.doc, viewId, { properties: list });
  });
}
