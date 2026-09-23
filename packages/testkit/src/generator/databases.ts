/**
 * Database templates for generated workspaces. Together they use every property type (except the
 * reserved `formula`) and every view type, with realistic rows: a project tracker, a reading list
 * and meeting notes, linked by a two-way relation (meetings ↔ projects).
 */
import type { JsonValue, PropertyType, TagColor } from '@tessera/core';
import type { Random } from './random';
import { capitalize, fill } from './text';
import type { DatabasePlan, PropertyPlan, ViewPlan } from './types';
import { MONTHS, PEOPLE, TOPICS, type Topic } from './words';

export const DATABASE_TEMPLATES = ['projects', 'reading', 'meetings'] as const;
export type DatabaseTemplate = (typeof DATABASE_TEMPLATES)[number];

/** Every property type the generator covers (all of `PROPERTY_TYPES` but the reserved `formula`). */
export const GENERATED_PROPERTY_TYPES: readonly PropertyType[] = [
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
];

const TITLES: Record<DatabaseTemplate, string> = {
  projects: 'Project tracker',
  reading: 'Reading list',
  meetings: 'Meeting notes',
};

const ICONS: Record<DatabaseTemplate, string> = { projects: '📋', reading: '📚', meetings: '🗓️' };

const BOOKS: ReadonlyArray<readonly [string, string, string]> = [
  ['Carrying the Fire', 'Michael Collins', 'History'],
  ['The Right Stuff', 'Tom Wolfe', 'History'],
  ['Packing for Mars', 'Mary Roach', 'Science'],
  ['The Soul of a New Machine', 'Tracy Kidder', 'Engineering'],
  ['Designing Data-Intensive Applications', 'Martin Kleppmann', 'Engineering'],
  ['The Pragmatic Programmer', 'Andrew Hunt', 'Engineering'],
  ['A Philosophy of Software Design', 'John Ousterhout', 'Engineering'],
  ['The Design of Everyday Things', 'Don Norman', 'Design'],
  ['Shape Up', 'Ryan Singer', 'Design'],
  ['Salt Fat Acid Heat', 'Samin Nosrat', 'Food'],
  ['The Food Lab', 'J. Kenji López-Alt', 'Food'],
  ['Tartine Bread', 'Chad Robertson', 'Food'],
  ['The Overstory', 'Richard Powers', 'Fiction'],
  ['Project Hail Mary', 'Andy Weir', 'Fiction'],
  ['The Left Hand of Darkness', 'Ursula K. Le Guin', 'Fiction'],
  ['Braiding Sweetgrass', 'Robin Wall Kimmerer', 'Science'],
  ['The Hidden Life of Trees', 'Peter Wohlleben', 'Science'],
  ['Hidden Figures', 'Margot Lee Shetterly', 'Biography'],
  ['Surely You Are Joking, Mr. Feynman', 'Richard Feynman', 'Biography'],
  ['The Mom Test', 'Rob Fitzpatrick', 'Design'],
  ['Thinking in Systems', 'Donella Meadows', 'Science'],
  ['The Old Ways', 'Robert Macfarlane', 'History'],
  ['Kitchen Confidential', 'Anthony Bourdain', 'Biography'],
  ['Cosmos', 'Carl Sagan', 'Science'],
];

const GENRES: ReadonlyArray<readonly [string, TagColor]> = [
  ['Science', 'blue'],
  ['History', 'brown'],
  ['Engineering', 'purple'],
  ['Design', 'pink'],
  ['Food', 'orange'],
  ['Fiction', 'green'],
  ['Biography', 'gray'],
];

const TIME_ZONES = ['Europe/Paris', 'America/New_York', 'Asia/Tokyo', 'UTC'];

const DAY = 86_400_000;

function isoDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/** A date within `days` days of `now`, date-only, sometimes a range. */
function dateValue(rng: Random, now: number, days: number, rangeChance: number): JsonValue {
  const start = now + rng.int(-days, days) * DAY;
  if (rng.chance(rangeChance)) {
    return { start: isoDate(start), end: isoDate(start + rng.int(1, 14) * DAY) };
  }
  return { start: isoDate(start) };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface Builder {
  rng: Random;
  now: number;
  properties: PropertyPlan[];
  add(property: Omit<PropertyPlan, 'id'>): string;
  option(propertyId: string, name: string): string;
}

function builder(rng: Random, now: number): Builder {
  const properties: PropertyPlan[] = [];
  return {
    rng,
    now,
    properties,
    add(property) {
      const id = rng.id();
      properties.push({
        ...property,
        id,
        ...(property.options ? { options: property.options.map((option) => ({ ...option })) } : {}),
      });
      return id;
    },
    option(propertyId, name) {
      const option = properties
        .find((property) => property.id === propertyId)
        ?.options?.find((candidate) => candidate.name === name);
      if (!option) throw new Error(`No option ${name}`);
      return option.id;
    },
  };
}

const options = (rng: Random, entries: ReadonlyArray<readonly [string, TagColor]>) =>
  entries.map(([name, color]) => ({ id: rng.id(), name, color }));

/** The database's schema and views, before rows. */
export interface DatabaseSchema {
  plan: Omit<DatabasePlan, 'rows'>;
  /** Makes one row's values (relations are filled in later). */
  rowValues(rng: Random, rowIndex: number): Record<string, JsonValue>;
  /** A title for row `index`. */
  rowTitle(rng: Random, index: number): string;
  /** The relation properties to fill after every database has rows. */
  relations: Array<{
    propertyId: string;
    target: 'self' | DatabaseTemplate;
    limit: 'one' | 'many';
  }>;
}

/** Builds a database's schema from a template. `suffix` distinguishes repeated templates. */
export function databaseSchema(
  template: DatabaseTemplate,
  rng: Random,
  input: { id: string; now: number; createdAt: number; suffix: string },
): DatabaseSchema {
  const b = builder(rng, input.now);
  const title = `${TITLES[template]}${input.suffix}`;
  const views: ViewPlan[] = [];
  const relations: DatabaseSchema['relations'] = [];
  const view = (plan: Omit<ViewPlan, 'id'>) => views.push({ ...plan, id: rng.id() });
  const group = (propertyId: string) => ({
    propertyId,
    order: [],
    hidden: [],
    collapsed: [],
    hideEmptyGroups: false,
    dateBucket: 'month' as const,
  });
  const product = TOPICS.find((topic) => topic.id === 'product') as Topic;
  const engineering = TOPICS.find((topic) => topic.id === 'engineering') as Topic;

  if (template === 'projects') {
    const name = b.add({ name: 'Name', type: 'title' });
    const status = b.add({
      name: 'Status',
      type: 'select',
      options: options(rng, [
        ['Backlog', 'gray'],
        ['Planned', 'blue'],
        ['In progress', 'yellow'],
        ['In review', 'purple'],
        ['Done', 'green'],
      ]),
    });
    const priority = b.add({
      name: 'Priority',
      type: 'select',
      options: options(rng, [
        ['P0', 'red'],
        ['P1', 'orange'],
        ['P2', 'yellow'],
        ['P3', 'gray'],
      ]),
    });
    const owners = b.add({
      name: 'Owners',
      type: 'multiSelect',
      options: options(
        rng,
        PEOPLE.slice(0, 8).map(
          (person, index) =>
            [
              person,
              (['blue', 'green', 'purple', 'pink', 'orange', 'brown', 'red', 'yellow'] as const)[
                index
              ] ?? 'gray',
            ] as const,
        ),
      ),
    });
    const due = b.add({ name: 'Due', type: 'date', date: { format: 'medium' } });
    const estimate = b.add({
      name: 'Estimate (days)',
      type: 'number',
      number: { format: 'plain', precision: 0 },
    });
    const progress = b.add({
      name: 'Progress',
      type: 'number',
      number: { format: 'percent', precision: 0 },
    });
    const budget = b.add({
      name: 'Budget',
      type: 'number',
      number: { format: 'currency', currency: 'USD', precision: 0 },
    });
    const shipped = b.add({ name: 'Shipped', type: 'checkbox' });
    const spec = b.add({ name: 'Spec', type: 'url' });
    const contact = b.add({ name: 'Contact', type: 'email' });
    const notes = b.add({ name: 'Notes', type: 'text' });
    const dependsOn = b.add({
      name: 'Depends on',
      type: 'relation',
      relation: { targetDatabaseId: input.id, backPropertyId: null, limit: 'many' },
    });
    relations.push({ propertyId: dependsOn, target: 'self', limit: 'many' });
    b.add({ name: 'Created', type: 'createdTime' });
    b.add({ name: 'Updated', type: 'updatedTime' });

    view({
      name: 'All projects',
      type: 'table',
      sorts: [{ propertyId: due, direction: 'asc' }],
      table: { summaries: { [name]: 'count', [progress]: 'average', [budget]: 'sum' } },
    });
    view({ name: 'Board', type: 'board', group: group(status), board: { colorColumns: true } });
    view({ name: 'Calendar', type: 'calendar', calendar: { datePropertyId: due, mode: 'month' } });
    view({
      name: 'Gallery',
      type: 'gallery',
      gallery: { cover: { kind: 'none' }, showPropertyNames: true },
    });
    view({ name: 'List', type: 'list', sorts: [{ propertyId: priority, direction: 'asc' }] });

    const statuses = ['Backlog', 'Planned', 'In progress', 'In review', 'Done'];
    return {
      plan: {
        id: input.id,
        template,
        title,
        titlePropertyId: name,
        properties: b.properties,
        views,
        createdAt: input.createdAt,
      },
      relations,
      rowTitle: (random) =>
        capitalize(
          `${random.pick(random.chance(0.5) ? product.verbs : engineering.verbs)} the ${random.pick(random.chance(0.5) ? product.nouns : engineering.nouns)}`,
        ),
      rowValues(random) {
        const statusName = random.weighted(
          statuses.map((value, index) => [value, [2, 2, 3, 2, 3][index] ?? 1] as const),
        );
        const done = statusName === 'Done';
        const values: Record<string, JsonValue> = {
          [status]: b.option(status, statusName),
          [priority]: b.option(
            priority,
            random.weighted([
              ['P0', 1],
              ['P1', 3],
              ['P2', 4],
              ['P3', 2],
            ] as const),
          ),
          [owners]: random
            .sample(b.properties.find((p) => p.id === owners)?.options ?? [], random.int(1, 3))
            .map((option) => option.id),
          [due]: dateValue(random, input.now, 45, 0.25),
          [estimate]: random.int(1, 20),
          [progress]: done ? 1 : random.int(0, 19) / 20,
          [budget]: random.int(1, 40) * 250,
          [shipped]: done,
          [spec]: `https://example.com/specs/${slug(random.pick(engineering.nouns))}-${random.int(10, 99)}`,
          [contact]: `${random.pick(PEOPLE).toLowerCase()}@example.com`,
          [notes]: fill(random.pick(product.sentences), random, product),
        };
        if (random.chance(0.12)) delete values[due];
        if (random.chance(0.2)) delete values[notes];
        return values;
      },
    };
  }

  if (template === 'reading') {
    const name = b.add({ name: 'Title', type: 'title' });
    const author = b.add({ name: 'Author', type: 'text' });
    const genres = b.add({ name: 'Genres', type: 'multiSelect', options: options(rng, GENRES) });
    const status = b.add({
      name: 'Status',
      type: 'select',
      options: options(rng, [
        ['To read', 'gray'],
        ['Reading', 'blue'],
        ['Finished', 'green'],
        ['Abandoned', 'red'],
      ]),
    });
    const rating = b.add({
      name: 'Rating',
      type: 'number',
      number: { format: 'plain', precision: 1 },
    });
    const finished = b.add({ name: 'Finished on', type: 'date', date: { format: 'long' } });
    const price = b.add({
      name: 'Price',
      type: 'number',
      number: { format: 'currency', currency: 'EUR', precision: 2 },
    });
    const link = b.add({ name: 'Link', type: 'url' });
    const recommended = b.add({ name: 'Recommended by', type: 'email' });
    const favorite = b.add({ name: 'Favorite', type: 'checkbox' });
    const related = b.add({
      name: 'Related books',
      type: 'relation',
      relation: { targetDatabaseId: input.id, backPropertyId: null, limit: 'many' },
    });
    relations.push({ propertyId: related, target: 'self', limit: 'many' });
    b.add({ name: 'Added', type: 'createdTime' });

    view({
      name: 'Shelf',
      type: 'table',
      sorts: [{ propertyId: rating, direction: 'desc' }],
      table: { summaries: { [name]: 'count', [rating]: 'average', [price]: 'sum' } },
    });
    view({ name: 'By status', type: 'board', group: group(status) });
    view({
      name: 'Finished',
      type: 'calendar',
      calendar: { datePropertyId: finished, mode: 'month' },
    });
    view({ name: 'Covers', type: 'gallery', gallery: { size: 'large' } });
    view({ name: 'Titles', type: 'list', list: { showPropertyNames: true } });

    return {
      plan: {
        id: input.id,
        template,
        title,
        titlePropertyId: name,
        properties: b.properties,
        views,
        createdAt: input.createdAt,
      },
      relations,
      rowTitle: (_random, index) => {
        const book = BOOKS[index % BOOKS.length] ?? BOOKS[0];
        const round = Math.floor(index / BOOKS.length);
        return round
          ? `${book?.[0] ?? 'Untitled'} (reread ${round + 1})`
          : (book?.[0] ?? 'Untitled');
      },
      rowValues(random, index) {
        const book = BOOKS[index % BOOKS.length] ?? BOOKS[0];
        const statusName = random.weighted([
          ['To read', 3],
          ['Reading', 2],
          ['Finished', 4],
          ['Abandoned', 1],
        ] as const);
        const genreOptions = b.properties.find((p) => p.id === genres)?.options ?? [];
        const primary = genreOptions.find((option) => option.name === book?.[2]);
        const extra = random.chance(0.3)
          ? random.sample(
              genreOptions.filter((option) => option !== primary),
              1,
            )
          : [];
        const values: Record<string, JsonValue> = {
          [author]: book?.[1] ?? '',
          [genres]: [...(primary ? [primary.id] : []), ...extra.map((option) => option.id)],
          [status]: b.option(status, statusName),
          [price]: random.int(900, 3200) / 100,
          [link]: `https://openlibrary.org/search?q=${encodeURIComponent(book?.[0] ?? '')}`,
          [recommended]: `${random.pick(PEOPLE).toLowerCase()}@example.com`,
          [favorite]: random.chance(0.25),
        };
        if (statusName === 'Finished') {
          values[rating] = random.int(6, 10) / 2;
          values[finished] = { start: isoDate(input.now - random.int(1, 200) * DAY) };
        }
        return values;
      },
    };
  }

  const name = b.add({ name: 'Meeting', type: 'title' });
  const when = b.add({ name: 'When', type: 'date', date: { format: 'medium', timeFormat: '24h' } });
  const type = b.add({
    name: 'Type',
    type: 'select',
    options: options(rng, [
      ['Standup', 'blue'],
      ['Planning', 'purple'],
      ['Retro', 'orange'],
      ['One on one', 'green'],
      ['Review', 'pink'],
    ]),
  });
  const attendees = b.add({
    name: 'Attendees',
    type: 'multiSelect',
    options: options(
      rng,
      PEOPLE.slice(0, 10).map((person) => [person, 'default'] as const),
    ),
  });
  const project = b.add({
    name: 'Project',
    type: 'relation',
    relation: { targetDatabaseId: null, backPropertyId: null, limit: 'one' },
  });
  relations.push({ propertyId: project, target: 'projects', limit: 'one' });
  const summary = b.add({ name: 'Summary', type: 'text' });
  const recording = b.add({ name: 'Recording', type: 'url' });
  const followUp = b.add({ name: 'Follow-up needed', type: 'checkbox' });
  b.add({ name: 'Last edited', type: 'updatedTime' });

  view({ name: 'Recent', type: 'table', sorts: [{ propertyId: when, direction: 'desc' }] });
  view({ name: 'By type', type: 'board', group: group(type) });
  view({ name: 'Schedule', type: 'calendar', calendar: { datePropertyId: when, mode: 'week' } });
  view({ name: 'Cards', type: 'gallery' });
  view({
    name: 'Agenda',
    type: 'list',
    filter: {
      id: rng.id(),
      type: 'group',
      conjunction: 'and',
      children: [
        { id: rng.id(), type: 'condition', propertyId: followUp, operator: 'is', value: true },
      ],
    },
  });

  const types = ['Standup', 'Planning', 'Retro', 'One on one', 'Review'];
  return {
    plan: {
      id: input.id,
      template,
      title,
      titlePropertyId: name,
      properties: b.properties,
      views,
      createdAt: input.createdAt,
    },
    relations,
    rowTitle: (random, index) => {
      const kind = types[index % types.length] ?? 'Standup';
      return `${kind} ${random.pick(MONTHS)} ${random.int(1, 28)}`;
    },
    rowValues(random, index) {
      const kind = types[index % types.length] ?? 'Standup';
      const start = input.now + random.int(-40, 20) * DAY + random.int(8, 17) * 3_600_000;
      const topic = random.pick(TOPICS);
      const attendeeOptions = b.properties.find((p) => p.id === attendees)?.options ?? [];
      return {
        [when]: {
          start: new Date(start).toISOString(),
          end: new Date(start + random.pick([15, 30, 45, 60]) * 60_000).toISOString(),
          includeTime: true,
          timeZone: random.pick(TIME_ZONES),
        },
        [type]: b.option(type, kind),
        [attendees]: random.sample(attendeeOptions, random.int(2, 5)).map((option) => option.id),
        [summary]: fill(random.pick(topic.sentences), random, topic),
        [recording]: `https://example.com/recordings/${slug(kind)}-${index + 1}`,
        [followUp]: random.chance(0.3),
      };
    },
  };
}

export const DATABASE_ICONS = ICONS;
