import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { InvalidOperationError, NotFoundError, ValidationError } from '../errors';
import { createPageIndex } from '../model/page-index';
import { createPage, listPages, trashPage } from '../model/pages';
import {
  addProperty,
  addRow,
  addSelectOption,
  addView,
  countRows,
  deleteProperty,
  deleteRow,
  deleteSelectOption,
  deleteView,
  duplicateView,
  findSelectOption,
  getCellValue,
  getDatabaseMeta,
  getProperty,
  getRow,
  getTitleProperty,
  getView,
  initDatabaseDoc,
  listProperties,
  listRows,
  listViews,
  moveProperty,
  moveRow,
  moveSelectOption,
  moveView,
  observeDatabase,
  resolveRows,
  setRowTemplate,
  setRowValue,
  setRowValues,
  updateProperty,
  updateSelectOption,
  updateView,
  type DatabaseChange,
} from './database-doc';
import { isEmptyPropertyValue, validatePropertyValue } from './types';
import {
  filterDepth,
  filterGroupSchema,
  removePropertyFromFilter,
  resolveViewProperties,
  type FilterGroup,
} from './views';

const names = { titlePropertyName: 'Name', viewName: 'Table' };

function setup() {
  const db = new Y.Doc();
  const { titlePropertyId, viewId } = initDatabaseDoc(db, names, { now: 10 });
  return { db, titlePropertyId, viewId };
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe('initDatabaseDoc', () => {
  it('creates a title property, one table view and meta, idempotently', () => {
    const { db, titlePropertyId, viewId } = setup();
    expect(getTitleProperty(db)).toMatchObject({
      id: titlePropertyId,
      name: 'Name',
      type: 'title',
    });
    expect(listViews(db).map((view) => [view.id, view.name, view.type])).toEqual([
      [viewId, 'Table', 'table'],
    ]);
    expect(getDatabaseMeta(db)).toEqual({ schemaVersion: 1, createdAt: 10, rowTemplateId: null });
    expect(initDatabaseDoc(db, names)).toEqual({ titlePropertyId, viewId });
    expect(listProperties(db)).toHaveLength(1);
    setRowTemplate(db, 'template-page');
    expect(getDatabaseMeta(db).rowTemplateId).toBe('template-page');
    setRowTemplate(db, null);
    expect(getDatabaseMeta(db).rowTemplateId).toBeNull();
  });
});

describe('properties', () => {
  it('adds every property type with its configuration', () => {
    const { db } = setup();
    const types = [
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
    for (const type of types) addProperty(db, { name: type, type });
    const byName = new Map(listProperties(db).map((property) => [property.name, property]));
    expect([...byName.keys()]).toEqual(['Name', ...types]);
    expect(byName.get('number')?.number).toEqual({
      format: 'plain',
      currency: 'USD',
      precision: null,
    });
    expect(byName.get('date')?.date).toEqual({ format: 'medium', timeFormat: 'locale' });
    expect(byName.get('select')?.options).toEqual([]);
    expect(byName.get('relation')?.relation).toEqual({
      targetDatabaseId: null,
      backPropertyId: null,
      limit: 'many',
    });
    expect(() => addProperty(db, { name: 'Second title', type: 'title' })).toThrow(
      InvalidOperationError,
    );
  });

  it('honours positions, renames, and merges config on update', () => {
    const { db, titlePropertyId } = setup();
    const price = addProperty(db, {
      name: 'Price',
      type: 'number',
      number: { format: 'currency', currency: 'EUR' },
    });
    const notes = addProperty(db, { name: 'Notes', type: 'text', position: 'start' });
    expect(listProperties(db).map((p) => p.name)).toEqual(['Notes', 'Name', 'Price']);
    moveProperty(db, notes.id, 'end');
    expect(listProperties(db).map((p) => p.name)).toEqual(['Name', 'Price', 'Notes']);
    moveProperty(db, notes.id, { before: titlePropertyId });
    expect(listProperties(db).map((p) => p.name)).toEqual(['Notes', 'Name', 'Price']);
    const updated = updateProperty(db, price.id, {
      name: '  Cost ',
      number: { precision: 2 },
      description: 'Before tax',
    });
    expect(updated).toMatchObject({
      name: 'Cost',
      description: 'Before tax',
      number: { format: 'currency', currency: 'EUR', precision: 2 },
    });
    expect(updateProperty(db, price.id, { description: null }).description).toBeUndefined();
    expect(() => updateProperty(db, price.id, { number: { currency: 'euro' } })).toThrow(
      ValidationError,
    );
  });

  it('changes types but never to or from title', () => {
    const { db, titlePropertyId } = setup();
    const status = addProperty(db, { name: 'Status', type: 'text' });
    expect(updateProperty(db, status.id, { type: 'select' })).toMatchObject({
      type: 'select',
      options: [],
    });
    expect(() => updateProperty(db, status.id, { type: 'title' })).toThrow(InvalidOperationError);
    expect(() => updateProperty(db, titlePropertyId, { type: 'text' })).toThrow(
      InvalidOperationError,
    );
    expect(() => deleteProperty(db, titlePropertyId)).toThrow(InvalidOperationError);
    expect(() => updateProperty(db, 'missing', { name: 'x' })).toThrow(NotFoundError);
  });

  it('deletes a property with its values and every view reference', () => {
    const { db, viewId } = setup();
    const due = addProperty(db, { name: 'Due', type: 'date' });
    const tag = addProperty(db, { name: 'Tag', type: 'select', options: [{ name: 'A' }] });
    const row = addRow(db, { values: { [due.id]: { start: '2026-01-02' } } });
    const filter: FilterGroup = {
      type: 'group',
      id: 'root',
      conjunction: 'and',
      children: [
        { type: 'condition', id: 'c1', propertyId: due.id, operator: 'isEmpty' },
        {
          type: 'group',
          id: 'g',
          conjunction: 'or',
          children: [{ type: 'condition', id: 'c2', propertyId: due.id, operator: 'isNotEmpty' }],
        },
        { type: 'condition', id: 'c3', propertyId: tag.id, operator: 'isEmpty' },
      ],
    };
    updateView(db, viewId, {
      filter,
      sorts: [{ propertyId: due.id, direction: 'asc' }],
      properties: [{ propertyId: due.id, visible: true, width: 120 }],
      table: { summaries: { [due.id]: 'earliest' } },
      calendar: { datePropertyId: due.id },
      gallery: { cover: { kind: 'property', propertyId: due.id } },
      group: {
        propertyId: due.id,
        order: [],
        hidden: [],
        collapsed: [],
        hideEmptyGroups: false,
        dateBucket: 'month',
      },
    });
    deleteProperty(db, due.id);
    const view = getView(db, viewId);
    expect(getProperty(db, due.id)).toBeUndefined();
    expect(getRow(db, row.id)?.values).toEqual({});
    expect(view?.sorts).toEqual([]);
    expect(view?.properties).toEqual([]);
    expect(view?.group).toBeNull();
    expect(view?.table.summaries).toEqual({});
    expect(view?.calendar.datePropertyId).toBeNull();
    expect(view?.gallery.cover).toEqual({ kind: 'none' });
    expect(view?.filter?.children).toEqual([
      { type: 'condition', id: 'c3', propertyId: tag.id, operator: 'isEmpty' },
    ]);
  });
});

describe('select options', () => {
  it('adds, finds, renames, recolors, moves and deletes options', () => {
    const { db, viewId } = setup();
    const tags = addProperty(db, {
      name: 'Tags',
      type: 'multiSelect',
      options: [{ name: 'Urgent', color: 'red' }, { name: 'Later' }],
    });
    const [urgent, later] = getProperty(db, tags.id)?.options ?? [];
    expect(urgent).toMatchObject({ name: 'Urgent', color: 'red' });
    expect(later?.color).not.toBe('default');
    const extra = addSelectOption(db, tags.id, { name: ' Blocked ' });
    expect(extra.name).toBe('Blocked');
    const property = getProperty(db, tags.id);
    expect(property && findSelectOption(property, 'urgent')?.id).toBe(urgent?.id);
    updateSelectOption(db, tags.id, extra.id, { name: 'Waiting', color: 'purple' });
    moveSelectOption(db, tags.id, extra.id, 'start');
    expect(getProperty(db, tags.id)?.options?.map((o) => [o.name, o.color])).toEqual([
      ['Waiting', 'purple'],
      ['Urgent', 'red'],
      ['Later', later?.color],
    ]);
    const row = addRow(db, { values: { [tags.id]: [urgent?.id ?? '', extra.id] } });
    updateView(db, viewId, {
      group: {
        propertyId: tags.id,
        order: [extra.id],
        hidden: [extra.id],
        collapsed: [],
        hideEmptyGroups: false,
        dateBucket: 'month',
      },
    });
    deleteSelectOption(db, tags.id, extra.id);
    expect(getRow(db, row.id)?.values[tags.id]).toEqual([urgent?.id]);
    expect(getView(db, viewId)?.group).toMatchObject({ order: [], hidden: [] });
    expect(() => addSelectOption(db, getTitleProperty(db)?.id ?? '', { name: 'x' })).toThrow(
      InvalidOperationError,
    );
  });

  it('keeps options created concurrently by two clients', () => {
    const one = new Y.Doc();
    initDatabaseDoc(one, names);
    const status = addProperty(one, { name: 'Status', type: 'select' });
    const two = new Y.Doc();
    sync(one, two);
    addSelectOption(one, status.id, { name: 'Urgent' });
    addSelectOption(two, status.id, { name: 'Blocked' });
    sync(one, two);
    for (const doc of [one, two]) {
      expect(
        getProperty(doc, status.id)
          ?.options?.map((o) => o.name)
          .sort(),
      ).toEqual(['Blocked', 'Urgent']);
    }
  });
});

describe('rows', () => {
  it('adds rows with validated values and keeps manual order', () => {
    const { db } = setup();
    const done = addProperty(db, { name: 'Done', type: 'checkbox' });
    const points = addProperty(db, { name: 'Points', type: 'number' });
    const first = addRow(
      db,
      { id: 'row-1', values: { [done.id]: true } },
      { now: 5, userId: 'u1' },
    );
    const second = addRow(db, { id: 'row-2', position: 'start' });
    const third = addRow(db, { id: 'row-3', position: { after: 'row-2' } });
    expect(listRows(db).map((row) => row.id)).toEqual([second.id, third.id, first.id]);
    expect(first).toMatchObject({
      values: { [done.id]: true },
      valuesUpdatedAt: 5,
      valuesUpdatedBy: 'u1',
    });
    setRowValues(db, first.id, { [points.id]: 3, [done.id]: null }, { now: 6 });
    expect(getRow(db, first.id)).toMatchObject({ values: { [points.id]: 3 }, valuesUpdatedAt: 6 });
    moveRow(db, first.id, 'start');
    expect(listRows(db)[0]?.id).toBe(first.id);
    deleteRow(db, third.id);
    expect(countRows(db)).toBe(2);
    expect(() => deleteRow(db, third.id)).toThrow(NotFoundError);
    expect(() => addRow(db, { id: first.id })).toThrow(InvalidOperationError);
  });

  it('rejects invalid values, unknown options and computed properties', () => {
    const { db, titlePropertyId } = setup();
    const status = addProperty(db, {
      name: 'Status',
      type: 'select',
      options: [{ id: 'todo', name: 'Todo' }],
    });
    const due = addProperty(db, { name: 'Due', type: 'date' });
    const created = addProperty(db, { name: 'Created', type: 'createdTime' });
    const row = addRow(db);
    expect(() => setRowValue(db, row.id, status.id, 'nope')).toThrow(ValidationError);
    setRowValue(db, row.id, status.id, 'todo');
    expect(() => setRowValue(db, row.id, due.id, { start: '2026-02-30' })).toThrow(ValidationError);
    expect(() => setRowValue(db, row.id, due.id, 'tomorrow')).toThrow(ValidationError);
    expect(() => setRowValue(db, row.id, titlePropertyId, 'Title')).toThrow(InvalidOperationError);
    expect(() => setRowValue(db, row.id, created.id, 1)).toThrow(InvalidOperationError);
    expect(() => setRowValue(db, row.id, 'missing', 1)).toThrow(NotFoundError);
    expect(() => setRowValue(db, 'no-row', status.id, 'todo')).toThrow(NotFoundError);
  });

  it('joins rows with pages and reads cells for every type', () => {
    const ws = new Y.Doc();
    const database = createPage(ws, { kind: 'database', title: 'Tasks' });
    const { db, titlePropertyId } = setup();
    const status = addProperty(db, {
      name: 'Status',
      type: 'select',
      options: [{ id: 'todo', name: 'Todo' }],
    });
    const points = addProperty(db, { name: 'Points', type: 'number' });
    const createdProp = addProperty(db, { name: 'Created', type: 'createdTime' });
    const updatedProp = addProperty(db, { name: 'Updated', type: 'updatedTime' });
    const formula = addProperty(db, {
      name: 'Formula',
      type: 'formula',
      formula: { expression: '1 + 1' },
    });
    const page = createPage(
      ws,
      { title: 'Write spec', parentId: database.id, icon: '📝' },
      { now: 100, userId: 'u1' },
    );
    addRow(db, { id: page.id, values: { [status.id]: 'todo' } }, { now: 200, userId: 'u2' });
    addRow(db, { id: 'orphan-row' }, { now: 50 });
    const gone = createPage(ws, { title: 'Gone', parentId: database.id });
    addRow(db, { id: gone.id });
    trashPage(ws, gone.id);
    const index = createPageIndex(listPages(ws));
    const [row, orphan, trashed] = resolveRows(listRows(db), index);
    expect(row).toMatchObject({
      title: 'Write spec',
      icon: '📝',
      createdAt: 100,
      updatedAt: 200,
      createdBy: 'u1',
      updatedBy: 'u2',
      trashed: false,
      missingPage: false,
    });
    expect(orphan).toMatchObject({ title: '', missingPage: true, trashed: false });
    expect(trashed?.trashed).toBe(true);
    const props = listProperties(db);
    const cell = (id: string) => {
      const property = props.find((p) => p.id === id);
      return row && property ? getCellValue(row, property) : undefined;
    };
    expect(cell(titlePropertyId)).toBe('Write spec');
    expect(cell(status.id)).toBe('todo');
    expect(cell(points.id)).toBeNull();
    expect(cell(createdProp.id)).toBe(100);
    expect(cell(updatedProp.id)).toBe(200);
    expect(cell(formula.id)).toBeNull();
  });
});

describe('views', () => {
  it('adds, updates, duplicates, moves and deletes views', () => {
    const { db, viewId } = setup();
    const status = addProperty(db, { name: 'Status', type: 'select' });
    const board = addView(db, {
      name: 'Board',
      type: 'board',
      group: {
        propertyId: status.id,
        order: [],
        hidden: [],
        collapsed: [],
        hideEmptyGroups: true,
        dateBucket: 'month',
      },
      board: { size: 'large' },
    });
    expect(board.board).toMatchObject({
      size: 'large',
      cover: { kind: 'none' },
      colorColumns: true,
    });
    const updated = updateView(db, board.id, {
      name: 'Kanban',
      board: { showPropertyNames: true },
      sorts: [{ propertyId: status.id, direction: 'desc' }],
    });
    expect(updated).toMatchObject({
      name: 'Kanban',
      board: { size: 'large', showPropertyNames: true },
    });
    const copy = duplicateView(db, board.id, { name: 'Kanban copy' });
    expect(listViews(db).map((view) => view.name)).toEqual(['Table', 'Kanban', 'Kanban copy']);
    expect(copy).toMatchObject({ type: 'board', sorts: updated.sorts, group: updated.group });
    moveView(db, copy.id, 'start');
    expect(listViews(db)[0]?.id).toBe(copy.id);
    deleteView(db, viewId);
    expect(listViews(db).map((view) => view.name)).toEqual(['Kanban copy', 'Kanban']);
    expect(() => deleteView(db, viewId)).toThrow(NotFoundError);
  });

  it('rejects invalid configuration without changing the view', () => {
    const { db, viewId } = setup();
    expect(() => updateView(db, viewId, { name: 'New', table: { frozenColumns: 99 } })).toThrow(
      ValidationError,
    );
    expect(() =>
      updateView(db, viewId, {
        filter: { type: 'group', id: 'r', conjunction: 'xor' as 'and', children: [] },
      }),
    ).toThrow(ValidationError);
    expect(getView(db, viewId)?.name).toBe('Table');
  });

  it('reads corrupted view fields as defaults', () => {
    const { db, viewId } = setup();
    const raw = db.getMap<Y.Map<unknown>>('views').get(viewId);
    raw?.set('sorts', 'nonsense');
    raw?.set('table', { frozenColumns: 2, wrapCells: 'yes' });
    raw?.set('type', 'spreadsheet');
    const view = getView(db, viewId);
    expect(view?.sorts).toEqual([]);
    expect(view?.type).toBe('table');
    expect(view?.table).toEqual({ wrapCells: false, frozenColumns: 1, summaries: {} });
  });

  it('resolves view properties with defaults per layout', () => {
    const { db, titlePropertyId } = setup();
    const a = addProperty(db, { name: 'A', type: 'text' });
    const b = addProperty(db, { name: 'B', type: 'text' });
    const properties = listProperties(db);
    const table = resolveViewProperties(properties, {
      type: 'table',
      properties: [
        { propertyId: b.id, visible: false, width: 200 },
        { propertyId: 'deleted', visible: true },
      ],
    });
    expect(table.map((entry) => [entry.property.id, entry.visible, entry.width])).toEqual([
      [b.id, false, 200],
      [titlePropertyId, true, undefined],
      [a.id, true, undefined],
    ]);
    const board = resolveViewProperties(properties, {
      type: 'board',
      properties: [{ propertyId: titlePropertyId, visible: false }],
    });
    expect(board.map((entry) => entry.visible)).toEqual([true, false, false]);
  });
});

describe('filters and values', () => {
  it('validates filter trees and prunes properties', () => {
    const tree: FilterGroup = {
      type: 'group',
      id: 'root',
      conjunction: 'or',
      children: [
        { type: 'condition', id: 'a', propertyId: 'p1', operator: 'is', value: 'x' },
        {
          type: 'group',
          id: 'g',
          conjunction: 'and',
          children: [
            {
              type: 'condition',
              id: 'b',
              propertyId: 'p2',
              operator: 'isWithin',
              value: { kind: 'range', range: 'next7Days' },
            },
          ],
        },
      ],
    };
    expect(filterGroupSchema.safeParse(tree).success).toBe(true);
    expect(filterDepth(tree)).toBe(2);
    expect(removePropertyFromFilter(tree, 'p2').children).toHaveLength(1);
    let deep: FilterGroup = { type: 'group', id: 'leaf', conjunction: 'and', children: [] };
    for (let i = 0; i < 9; i += 1)
      deep = { type: 'group', id: `g${i}`, conjunction: 'and', children: [deep] };
    expect(filterGroupSchema.safeParse(deep).success).toBe(false);
  });

  it('validates date values precisely', () => {
    expect(validatePropertyValue('date', { start: '2024-02-29' }).success).toBe(true);
    expect(validatePropertyValue('date', { start: '2023-02-29' }).success).toBe(false);
    expect(validatePropertyValue('date', { start: '2026-01-10', end: '2026-01-09' }).success).toBe(
      false,
    );
    expect(
      validatePropertyValue('date', {
        start: '2026-01-10T09:30:00.000Z',
        includeTime: true,
        timeZone: 'Europe/Paris',
      }).success,
    ).toBe(true);
    expect(
      validatePropertyValue('date', { start: '2026-01-10T09:30', includeTime: true }).success,
    ).toBe(false);
    expect(
      validatePropertyValue('date', {
        start: '2026-01-10T09:30:00+02:00',
        end: '2026-01-10T08:00:00Z',
        includeTime: true,
      }).success,
    ).toBe(true);
    expect(validatePropertyValue('number', Number.NaN).success).toBe(false);
    expect(validatePropertyValue('multiSelect', ['a', 'a']).success).toBe(false);
    expect(validatePropertyValue('relation', ['page-1', 'page-2']).success).toBe(true);
    expect(isEmptyPropertyValue('  ')).toBe(true);
    expect(isEmptyPropertyValue([])).toBe(true);
    expect(isEmptyPropertyValue(false)).toBe(false);
    expect(isEmptyPropertyValue(0)).toBe(false);
  });
});

describe('atomicity', () => {
  it('leaves the doc untouched when a helper throws', () => {
    const { db } = setup();
    const points = addProperty(db, { name: 'Points', type: 'number' });
    const row = addRow(db, { id: 'row', values: { [points.id]: 1 } });
    const before = Y.encodeStateVector(db);
    const unchanged = () => expect(Y.encodeStateVector(db)).toEqual(before);
    expect(() => setRowValues(db, row.id, { [points.id]: 2, missing: 3 })).toThrow(NotFoundError);
    unchanged();
    expect(() => addRow(db, { id: 'bad', values: { [points.id]: 'many' } })).toThrow(
      ValidationError,
    );
    unchanged();
    expect(() => addRow(db, { id: 'bad', position: { after: 'nope' } })).toThrow(NotFoundError);
    unchanged();
    expect(() =>
      addProperty(db, { name: 'Money', type: 'number', number: { currency: 'dollars' } }),
    ).toThrow(ValidationError);
    unchanged();
    expect(() => addProperty(db, { name: 'Text', type: 'text', options: [{ name: 'A' }] })).toThrow(
      ValidationError,
    );
    unchanged();
    expect(() =>
      updateProperty(db, points.id, { name: 'Renamed', number: { precision: 99 } }),
    ).toThrow(ValidationError);
    unchanged();
    expect(() =>
      addView(db, {
        name: 'Bad',
        type: 'table',
        sorts: [{ propertyId: points.id, direction: 'up' as 'asc' }],
      }),
    ).toThrow(ValidationError);
    unchanged();
    expect(getRow(db, row.id)?.values).toEqual({ [points.id]: 1 });
    expect(getProperty(db, points.id)?.name).toBe('Points');
  });
});

describe('observeDatabase', () => {
  it('reports one aggregated change per transaction', () => {
    const { db } = setup();
    const changes: DatabaseChange[] = [];
    const stop = observeDatabase(db, (change) => changes.push(change));
    const done = addProperty(db, { name: 'Done', type: 'checkbox' });
    const row = addRow(db, { id: 'r1' });
    setRowValue(db, row.id, done.id, true);
    const view = addView(db, { name: 'List', type: 'list' });
    db.transact(() => {
      addRow(db, { id: 'r2' });
      deleteRow(db, row.id);
      updateView(db, view.id, { name: 'Compact' });
    });
    stop();
    addRow(db, { id: 'r3' });
    expect(changes).toHaveLength(5);
    expect(changes[0]).toMatchObject({ schema: true, views: [], local: true });
    expect(changes[1]?.rows).toEqual({ added: ['r1'], updated: [], removed: [] });
    expect(changes[2]?.rows).toEqual({ added: [], updated: ['r1'], removed: [] });
    expect(changes[3]?.views).toEqual([view.id]);
    expect(changes[4]).toMatchObject({
      rows: { added: ['r2'], updated: [], removed: ['r1'] },
      views: [view.id],
    });
  });
});
