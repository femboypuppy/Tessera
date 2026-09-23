/**
 * Plans a workspace: every page's metadata, the tree, the databases and their rows. Content is
 * generated later, per page (content.ts), so the plan stays small even for 10,000 pages.
 */
import type { JsonValue } from '@tessera/core';
import { COVER_PRESET_NAMES } from './covers';
import {
  DATABASE_ICONS,
  DATABASE_TEMPLATES,
  databaseSchema,
  type DatabaseSchema,
  type DatabaseTemplate,
} from './databases';
import { Random } from './random';
import { capitalize, fill } from './text';
import type { DatabasePlan, GenerateOptions, PagePlan, ResolvedOptions } from './types';
import { GENERAL_TAGS, TOPICS, type Topic } from './words';

const DAY = 86_400_000;

/** Fills in the defaults of {@link GenerateOptions}. */
export function resolveOptions(options: GenerateOptions = {}): ResolvedOptions {
  const rows = options.rowsPerDatabase ?? [12, 40];
  const range: readonly [number, number] = typeof rows === 'number' ? [rows, rows] : rows;
  const count = (value: number | undefined, fallback: number, name: string) => {
    const result = value ?? fallback;
    if (!Number.isInteger(result) || result < 0)
      throw new RangeError(`${name} must be a whole number ≥ 0`);
    return result;
  };
  return {
    seed: options.seed ?? 1,
    pages: count(options.pages, 200, 'pages'),
    databases: count(options.databases, 3, 'databases'),
    rowsPerDatabase: [
      count(range[0], 12, 'rowsPerDatabase'),
      count(range[1], 40, 'rowsPerDatabase'),
    ],
    maxDepth: count(options.maxDepth, 5, 'maxDepth'),
    linksPerPage: Math.max(0, options.linksPerPage ?? 3),
    largePages: (options.largePages ?? []).map((size) => count(size, 1, 'largePages')),
    trashed: count(options.trashed, 0, 'trashed'),
    now: options.now ?? Date.UTC(2026, 0, 15, 9, 0, 0),
    folder: options.folder ?? '',
  };
}

export interface WorkspacePlan {
  options: ResolvedOptions;
  pages: PagePlan[];
  databases: DatabasePlan[];
  byId: ReadonlyMap<string, PagePlan>;
  /** Pages links point to, most popular first (links pick from this with a power law). */
  linkTargets: PagePlan[];
  linkTargetsByTopic: ReadonlyMap<string, PagePlan[]>;
  /** Pages that are in the trash directly or through an ancestor. */
  trashedIds: ReadonlySet<string>;
}

const TOPIC_WEIGHTS: Record<string, number> = {
  space: 3,
  engineering: 4,
  garden: 2,
  kitchen: 2,
  product: 4,
  travel: 2,
};

function topicById(id: string): Topic {
  const topic = TOPICS.find((candidate) => candidate.id === id);
  if (!topic) throw new Error(`Unknown topic ${id}`);
  return topic;
}

/** Plans the whole workspace from resolved options. Deterministic for a given seed. */
export function planWorkspace(options: ResolvedOptions): WorkspacePlan {
  const rng = new Random(options.seed);
  const tree = rng.fork('tree');
  const ids = rng.fork('ids');
  const words = rng.fork('titles');
  const pages: PagePlan[] = [];
  const byId = new Map<string, PagePlan>();
  const titles = new Set<string>();
  const span = 180 * DAY;
  const start = options.now - span;

  const uniqueTitle = (base: string): string => {
    let title = base.trim();
    for (let n = 2; titles.has(title.toLowerCase()); n += 1) title = `${base} (${n})`;
    titles.add(title.toLowerCase());
    return title;
  };
  const pickTopic = (random: Random) =>
    topicById(
      random.weighted(TOPICS.map((topic) => [topic.id, TOPIC_WEIGHTS[topic.id] ?? 1] as const)),
    );
  const pageTags = (random: Random, topic: Topic) => {
    const pool = [...topic.tags, ...GENERAL_TAGS];
    const count = random.weighted([
      [0, 4],
      [1, 4],
      [2, 2],
      [3, 1],
    ] as const);
    const tags = new Set<string>();
    for (let i = 0; i < count; i += 1) tags.add(pool[random.zipf(pool.length, 1.2)] ?? 'todo');
    return [...tags];
  };
  const add = (page: Omit<PagePlan, 'index'>): PagePlan => {
    const planned: PagePlan = { ...page, index: pages.length };
    pages.push(planned);
    byId.set(planned.id, planned);
    return planned;
  };
  const timeFor = (index: number, total: number, after?: PagePlan) => {
    const base =
      start + Math.floor((index / Math.max(1, total)) * span) + tree.int(0, 6) * 3_600_000;
    const createdAt = after ? Math.max(base, after.createdAt + 3_600_000) : base;
    const updatedAt = Math.min(
      options.now,
      createdAt + tree.int(0, 20) * DAY + tree.int(0, 23) * 3_600_000,
    );
    return {
      createdAt: Math.min(createdAt, options.now),
      updatedAt: Math.max(updatedAt, Math.min(createdAt, options.now)),
    };
  };

  // 1. Ordinary pages: about √N top-level pages, whose subtrees grow rich-get-richer up to a cap.
  const total = options.pages;
  const rootCount = total === 0 ? 0 : Math.min(total, Math.round(Math.sqrt(total) * 0.9) + 2);
  const cap = Math.max(24, Math.ceil((4 * total) / Math.max(1, rootCount)));
  const isRoot = tree.shuffle(Array.from({ length: total }, (_, index) => index < rootCount));
  const firstRoot = isRoot.indexOf(true);
  if (firstRoot > 0) [isRoot[0], isRoot[firstRoot]] = [true, false];
  const subtrees: Array<{ root: PagePlan; nodes: PagePlan[] }> = [];
  for (let index = 0; index < total; index += 1) {
    const open = subtrees.filter((subtree) => subtree.nodes.length < cap);
    const makeRoot = isRoot[index] || !open.length || options.maxDepth === 0;
    let parent: PagePlan | null = null;
    let topic: Topic;
    let subtree: { root: PagePlan; nodes: PagePlan[] } | undefined;
    if (makeRoot) {
      topic = pickTopic(tree);
    } else {
      subtree = tree.weighted(
        open.map((candidate) => [candidate, candidate.nodes.length ** 0.7] as const),
      );
      const shallow = subtree.nodes.filter((node) => node.depth < options.maxDepth);
      parent = tree.pick(shallow.length ? shallow : [subtree.root]);
      while (parent.depth > 0 && tree.chance(0.35))
        parent = byId.get(parent.parentId ?? '') ?? parent;
      topic = tree.chance(0.85) ? topicById(parent.topicId) : pickTopic(tree);
    }
    const id = ids.id();
    const page = add({
      id,
      role: 'page',
      kind: 'page',
      title: uniqueTitle(capitalize(fill(words.pick(topic.titles), words, topic))),
      ...(words.chance(0.35) ? { icon: words.pick(topic.icons) } : {}),
      ...(makeRoot && words.chance(0.12)
        ? { cover: { kind: 'preset' as const, value: words.pick(COVER_PRESET_NAMES) } }
        : {}),
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      rootId: parent ? parent.rootId : id,
      ...timeFor(index, total, parent ?? undefined),
      favorite: false,
      trashed: false,
      topicId: topic.id,
      tags: pageTags(words, topic),
      aliases: [],
    });
    if (makeRoot) subtrees.push({ root: page, nodes: [page] });
    else subtree?.nodes.push(page);
  }
  const ordinary = [...pages];

  // 2. Databases, placed at the top level or under ordinary pages, and their rows.
  const databases: DatabasePlan[] = [];
  const schemas: DatabaseSchema[] = [];
  const dbRng = rng.fork('databases');
  for (let d = 0; d < options.databases; d += 1) {
    const template = DATABASE_TEMPLATES[d % DATABASE_TEMPLATES.length] as DatabaseTemplate;
    const suffix =
      d >= DATABASE_TEMPLATES.length ? ` ${Math.floor(d / DATABASE_TEMPLATES.length) + 1}` : '';
    const hosts = ordinary.filter((page) => page.depth < options.maxDepth);
    const parent = hosts.length && dbRng.chance(0.65) ? dbRng.pick(hosts) : null;
    const id = ids.id();
    const times = timeFor(dbRng.int(0, Math.max(0, total - 1)), total, parent ?? undefined);
    const schema = databaseSchema(template, dbRng.fork(`schema:${d}`), {
      id,
      now: options.now,
      createdAt: times.createdAt,
      suffix,
    });
    const dbPage = add({
      id,
      role: 'database',
      kind: 'database',
      title: uniqueTitle(schema.plan.title),
      icon: DATABASE_ICONS[template],
      parentId: parent?.id ?? null,
      depth: parent ? parent.depth + 1 : 0,
      rootId: parent ? parent.rootId : id,
      ...times,
      favorite: d === 0,
      trashed: false,
      topicId: 'product',
      tags: [],
      aliases: [],
    });
    const rowRng = dbRng.fork(`rows:${d}`);
    const [min, max] = options.rowsPerDatabase;
    const rowCount = rowRng.int(Math.min(min, max), Math.max(min, max));
    const rows: DatabasePlan['rows'] = [];
    for (let r = 0; r < rowCount; r += 1) {
      const rowTimes = timeFor(r, rowCount, dbPage);
      const row = add({
        id: ids.id(),
        role: 'row',
        kind: 'page',
        title: uniqueTitle(schema.rowTitle(rowRng, r)),
        ...(rowRng.chance(0.1) ? { icon: rowRng.pick(['📌', '⭐', '🔥', '🧩', '📎']) } : {}),
        parentId: dbPage.id,
        depth: dbPage.depth + 1,
        rootId: dbPage.rootId,
        ...rowTimes,
        favorite: false,
        trashed: false,
        topicId: 'product',
        tags: [],
        aliases: [],
        databaseId: dbPage.id,
        hasBody: rowRng.chance(0.3),
      });
      rows.push({ id: row.id, values: schema.rowValues(rowRng, r), updatedAt: row.updatedAt });
    }
    const plan: DatabasePlan = { ...schema.plan, title: dbPage.title, rows };
    databases.push(plan);
    schemas.push(schema);
  }

  // 3. Relations, now that every database has rows. Meetings ↔ projects is two-way.
  const relationRng = rng.fork('relations');
  const projects = databases.find((database) => database.template === 'projects');
  databases.forEach((database, d) => {
    const schema = schemas[d];
    if (!schema) return;
    for (const relation of schema.relations) {
      const property = database.properties.find(
        (candidate) => candidate.id === relation.propertyId,
      );
      if (!property) continue;
      if (relation.target === 'self') {
        for (const row of database.rows) {
          if (!relationRng.chance(0.25) || database.rows.length < 2) continue;
          const others = database.rows.filter((candidate) => candidate.id !== row.id);
          row.values[property.id] = relationRng
            .sample(others, relationRng.int(1, 2))
            .map((other) => other.id);
        }
        continue;
      }
      if (!projects) {
        // No project tracker: the relation may point at any page, and stays empty.
        continue;
      }
      const backId = ids.id();
      projects.properties.push({
        id: backId,
        name: `${database.title}`,
        type: 'relation',
        relation: { targetDatabaseId: database.id, backPropertyId: property.id, limit: 'many' },
      });
      property.relation = {
        targetDatabaseId: projects.id,
        backPropertyId: backId,
        limit: relation.limit,
      };
      const back = new Map<string, string[]>();
      for (const row of database.rows) {
        if (!projects.rows.length || !relationRng.chance(0.7)) continue;
        const target = relationRng.pick(projects.rows);
        row.values[property.id] = [target.id];
        back.set(target.id, [...(back.get(target.id) ?? []), row.id]);
      }
      for (const row of projects.rows) {
        const linked = back.get(row.id);
        if (linked) row.values[backId] = linked as JsonValue;
      }
    }
  });

  // 4. Very long pages, at the top level.
  const largeRng = rng.fork('large');
  options.largePages.forEach((blockCount, n) => {
    const topic = pickTopic(largeRng);
    const id = ids.id();
    add({
      id,
      role: 'large',
      kind: 'page',
      title: uniqueTitle(`${topic.label} field notes${n ? ` ${n + 1}` : ''}`),
      icon: largeRng.pick(topic.icons),
      parentId: null,
      depth: 0,
      rootId: id,
      createdAt: options.now - 30 * DAY,
      updatedAt: options.now - DAY,
      favorite: false,
      trashed: false,
      topicId: topic.id,
      tags: [topic.tags[0] ?? 'reference'],
      aliases: [],
      blockCount,
    });
  });

  // 5. Favorites, aliases and the trash.
  const extras = rng.fork('extras');
  const favoriteCount = Math.min(ordinary.length, Math.max(2, Math.round(ordinary.length * 0.01)));
  for (const page of extras.sample(
    ordinary.filter((candidate) => candidate.depth <= 1),
    favoriteCount,
  )) {
    page.favorite = true;
  }
  for (const page of ordinary) {
    if (!extras.chance(0.06)) continue;
    const words = page.title.split(' ');
    if (words.length >= 3) page.aliases = [words.slice(0, 2).join(' ')];
  }
  const protectedIds = new Set<string>();
  for (const page of pages) {
    if (page.role === 'page') continue;
    for (
      let current = byId.get(page.parentId ?? '');
      current;
      current = byId.get(current.parentId ?? '')
    ) {
      protectedIds.add(current.id);
    }
  }
  const trashable = ordinary.filter(
    (page) => page.depth > 0 && !protectedIds.has(page.id) && !page.favorite,
  );
  // Never one trashed page inside another: the Trash lists pages trashed directly.
  const ancestorsOf = (page: PagePlan) => {
    const ids: string[] = [];
    for (
      let current = byId.get(page.parentId ?? '');
      current;
      current = byId.get(current.parentId ?? '')
    )
      ids.push(current.id);
    return ids;
  };
  let trashedCount = 0;
  for (const page of extras.shuffle(trashable)) {
    if (trashedCount >= options.trashed) break;
    const related =
      ancestorsOf(page).some((id) => byId.get(id)?.trashed) ||
      pages.some((other) => other.trashed && ancestorsOf(other).includes(page.id));
    if (related) continue;
    page.trashed = true;
    trashedCount += 1;
  }
  const trashedIds = new Set<string>();
  for (const page of pages) {
    let current: PagePlan | undefined = page;
    while (current) {
      if (current.trashed) {
        trashedIds.add(page.id);
        break;
      }
      current = byId.get(current.parentId ?? '');
    }
  }

  // 6. Link popularity: a random ranking; links pick ranks with a power law.
  const linkable = pages.filter((page) => page.role !== 'row' && !trashedIds.has(page.id));
  const linkTargets = rng.fork('ranks').shuffle(linkable);
  const linkTargetsByTopic = new Map<string, PagePlan[]>();
  for (const page of linkTargets) {
    const list = linkTargetsByTopic.get(page.topicId);
    if (list) list.push(page);
    else linkTargetsByTopic.set(page.topicId, [page]);
  }
  return { options, pages, databases, byId, linkTargets, linkTargetsByTopic, trashedIds };
}
