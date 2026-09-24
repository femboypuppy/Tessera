import { build as b, type BlockJSON, type DocJSON, type InlineJSON } from '@tessera/core';

/**
 * A seeded generator of realistic workspaces: topic hubs, subject pages and notes under them,
 * tags, aliases, tasks, tables, links that cluster by topic (so the graph shows communities), and
 * plain-text mentions of other pages (so there are unlinked mentions to find). The same seed always
 * produces the same workspace. Used by the benchmark, tests, and the e2e and screenshot seeding.
 */

/** A page of a generated workspace. IDs are stable per seed (`g<seed>-<n>`). */
export interface GeneratedPage {
  id: string;
  title: string;
  icon: string | null;
  parentId: string | null;
  doc: DocJSON;
  tags: string[];
  aliases: string[];
  /** Days since the last edit (0 = today). */
  ageDays: number;
}

export interface GeneratedWorkspace {
  seed: number;
  pages: GeneratedPage[];
}

export interface GeneratorOptions {
  /** Number of pages (topic hubs included). */
  pages: number;
  seed?: number;
}

/** Mulberry32: a tiny, fast, well-distributed seeded PRNG. */
export function createRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

interface Topic {
  name: string;
  icon: string;
  tag: string;
  subjects: string[];
  facets: string[];
  facts: string[];
  tasks: string[];
}

const TOPICS: Topic[] = [
  {
    name: 'Astronomy',
    icon: '🔭',
    tag: 'astronomy',
    subjects: [
      'Europa',
      'Titan',
      'Enceladus',
      'Andromeda Galaxy',
      'Betelgeuse',
      'Proxima Centauri',
      'Kuiper Belt',
      'Olympus Mons',
      'Crab Nebula',
      'Kepler-452b',
      'Saturn Rings',
      'Io',
      'Ganymede',
      'Oort Cloud',
      'Sagittarius A*',
      'Orion Nebula',
      'Vega',
      'Halley Comet',
    ],
    facets: ['observation log', 'open questions', 'reading notes', 'fact sheet', 'photo plan'],
    facts: [
      '{subject} is easiest to observe in late autumn from a dark site.',
      'The last good sighting of {subject} was logged at {number} arcseconds.',
      'Compare the brightness of {subject} with {other} before the next session.',
      'A 200 mm reflector shows enough detail on {subject} for sketches.',
      'The spectrum of {subject} suggests water ice near the surface.',
      'Estimated distance to {subject}: {number} light years, give or take.',
    ],
    tasks: ['Check the weather window', 'Collimate the telescope', 'Export the raw frames'],
  },
  {
    name: 'Marine biology',
    icon: '🐙',
    tag: 'ocean',
    subjects: [
      'Octopus cognition',
      'Coral bleaching',
      'Kelp forests',
      'Humpback song',
      'Bioluminescence',
      'Mantis shrimp',
      'Hydrothermal vents',
      'Seagrass meadows',
      'Leatherback turtles',
      'Plankton blooms',
      'Great Barrier Reef',
      'Deep sea anglerfish',
      'Sea otters',
      'Tide pools',
    ],
    facets: ['field notes', 'paper summary', 'dive log', 'species list', 'questions'],
    facts: [
      '{subject} changes noticeably when the water warms by {number} degrees.',
      'Our dive team recorded {subject} at {number} metres near the north wall.',
      'Recent papers link {subject} to {other} more closely than expected.',
      'Night dives are the best time to document {subject}.',
      'Sampling for {subject} needs permits from the marine park office.',
    ],
    tasks: ['Label the sample jars', 'Upload the dive photos', 'Email the lab about results'],
  },
  {
    name: 'Product roadmap',
    icon: '🗺️',
    tag: 'product',
    subjects: [
      'Offline sync',
      'Onboarding flow',
      'Command palette',
      'Graph view',
      'Plugin marketplace',
      'Mobile layout',
      'Public API',
      'Billing revamp',
      'Search ranking',
      'Import from Notion',
      'Dark mode polish',
      'Team workspaces',
      'Version history',
      'Keyboard shortcuts',
    ],
    facets: ['spec', 'retro', 'launch plan', 'user interviews', 'metrics review', 'decision log'],
    facts: [
      '{subject} ships behind a flag in sprint {number}.',
      'Interviews show that {subject} matters more than {other} for new teams.',
      'The main risk for {subject} is performance on large workspaces.',
      'We agreed to keep {subject} simple for the first release.',
      'Support tickets about {subject} dropped by {number} percent after the fix.',
    ],
    tasks: [
      'Write the release notes',
      'Review the design with the team',
      'Update the metrics dashboard',
    ],
  },
  {
    name: 'Reading notes',
    icon: '📚',
    tag: 'books',
    subjects: [
      'The Left Hand of Darkness',
      'Thinking in Systems',
      'The Pragmatic Programmer',
      'Dune',
      'Sapiens',
      'The Design of Everyday Things',
      'Gödel, Escher, Bach',
      'Middlemarch',
      'The Remains of the Day',
      'Deep Work',
      'Project Hail Mary',
      'The Structure of Scientific Revolutions',
    ],
    facets: ['highlights', 'chapter notes', 'quotes', 'review', 'discussion questions'],
    facts: [
      'Chapter {number} of {subject} reframes the whole argument.',
      '{subject} pairs well with {other} for a book club month.',
      'The best idea in {subject} is how small habits compound.',
      'I reread {subject} every few years and notice new details.',
    ],
    tasks: ['Finish the last chapter', 'Write a short review', 'Lend the copy to Sam'],
  },
  {
    name: 'Kitchen',
    icon: '🍳',
    tag: 'recipes',
    subjects: [
      'Sourdough starter',
      'Miso ramen',
      'Shakshuka',
      'Tarte tatin',
      'Green curry',
      'Focaccia',
      'Kimchi',
      'Risotto',
      'Pho',
      'Dal makhani',
      'Tamales',
      'Paella',
      'Cold brew',
      'Pierogi',
    ],
    facets: ['recipe', 'variations', 'shopping list', 'tasting notes'],
    facts: [
      '{subject} needs about {number} minutes of active time.',
      'Serve {subject} with {other} for a relaxed weekend dinner.',
      'Toasting the spices first makes {subject} noticeably deeper.',
      'The trick with {subject} is patience: low heat and time.',
    ],
    tasks: ['Buy fresh herbs', 'Feed the starter', 'Prep the stock on Sunday'],
  },
  {
    name: 'Travel',
    icon: '🧭',
    tag: 'travel',
    subjects: [
      'Kyoto',
      'Lisbon',
      'Patagonia',
      'Iceland ring road',
      'Oaxaca',
      'Tbilisi',
      'Hokkaido',
      'Dolomites',
      'Marrakesh',
      'Vancouver Island',
      'Istanbul',
      'Seoul',
      'Faroe Islands',
    ],
    facets: ['itinerary', 'packing list', 'budget', 'journal', 'places to eat'],
    facts: [
      'Spend at least {number} days in {subject} to see it without rushing.',
      'Pair {subject} with {other} if there is time for a second stop.',
      'Book the popular spots in {subject} a month ahead.',
      'Shoulder season is the best time to visit {subject}.',
    ],
    tasks: ['Book the flights', 'Renew the passport', 'Download offline maps'],
  },
  {
    name: 'Machine learning',
    icon: '🧠',
    tag: 'ml',
    subjects: [
      'Transformers',
      'Diffusion models',
      'Gradient descent',
      'Reinforcement learning',
      'Embeddings',
      'Attention heads',
      'Overfitting',
      'Contrastive learning',
      'Tokenization',
      'Beam search',
      'Knowledge distillation',
      'Graph neural networks',
      'Retrieval augmentation',
    ],
    facets: ['explainer', 'experiment log', 'paper notes', 'cheat sheet', 'open problems'],
    facts: [
      '{subject} became practical once hardware reached {number} teraflops.',
      'Our experiment with {subject} beat the baseline by {number} points.',
      '{subject} and {other} share more ideas than their names suggest.',
      'A small ablation shows that {subject} is sensitive to the learning rate.',
    ],
    tasks: ['Rerun with three seeds', 'Plot the loss curves', 'Clean up the notebook'],
  },
  {
    name: 'History',
    icon: '🏛️',
    tag: 'history',
    subjects: [
      'Apollo program',
      'Library of Alexandria',
      'Silk Road',
      'Printing press',
      'Hanseatic League',
      'Meiji Restoration',
      'Byzantine Empire',
      'Industrial Revolution',
      'Maya calendar',
      'Viking navigation',
      'Ottoman coffeehouses',
      'Great Fire of London',
    ],
    facets: ['timeline', 'sources', 'summary', 'key figures', 'map notes'],
    facts: [
      'Historians still debate how {subject} influenced {other}.',
      '{subject} lasted roughly {number} years by most accounts.',
      'Primary sources about {subject} are scattered across three archives.',
      'The economic side of {subject} is often overlooked.',
    ],
    tasks: ['Find a primary source', 'Draw the timeline', 'Cross-check the dates'],
  },
];

const EXTRA_TAGS = ['idea', 'todo', 'favorite', 'draft', 'reference', 'question'];
const ALIASES: Record<string, string> = {
  Europa: 'Jupiter II',
  Titan: 'Saturn VI',
  'Andromeda Galaxy': 'M31',
  'Crab Nebula': 'M1',
  'Command palette': 'Cmd+K',
  'Offline sync': 'Local-first sync',
  Dune: 'Dune (novel)',
  Transformers: 'Transformer models',
  'Apollo program': 'Project Apollo',
  Kyoto: '京都',
};

/** Picks a random element. */
function pick<T>(random: () => number, list: readonly T[]): T {
  const item = list[Math.floor(random() * list.length)];
  if (item === undefined) throw new Error('pick from an empty list');
  return item;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** Generates a workspace. Deterministic for a given `seed` and `pages`. */
export function generateWorkspace(options: GeneratorOptions): GeneratedWorkspace {
  const seed = options.seed ?? 1;
  const random = createRandom(seed);
  const total = Math.max(1, options.pages);
  const pages: GeneratedPage[] = [];
  const idFor = (n: number) => `g${seed}-${n.toString(36)}`;
  let counter = 0;
  const nextId = () => {
    counter += 1;
    return idFor(counter);
  };

  // Plan the tree first: topic hubs, subjects under them, notes under subjects.
  interface Plan {
    id: string;
    title: string;
    icon: string | null;
    parentId: string | null;
    topic: Topic;
    subject: string;
    level: 0 | 1 | 2;
  }
  const plans: Plan[] = [];
  const topics = TOPICS.slice(0, Math.max(1, Math.min(TOPICS.length, Math.ceil(total / 12))));
  for (const topic of topics) {
    if (plans.length >= total) break;
    plans.push({
      id: nextId(),
      title: topic.name,
      icon: topic.icon,
      parentId: null,
      topic,
      subject: topic.name,
      level: 0,
    });
  }
  const subjectPlans: Plan[] = [];
  let round = 0;
  while (plans.length < total) {
    const topicPlan = plans[subjectPlans.length % topics.length];
    if (!topicPlan) break;
    const topic = topicPlan.topic;
    const index = Math.floor(subjectPlans.length / topics.length);
    const subject = topic.subjects[index % topic.subjects.length] ?? topic.name;
    const cycle = Math.floor(index / topic.subjects.length);
    const title = cycle === 0 ? subject : `${subject} ${cycle + 1}`;
    const plan: Plan = {
      id: nextId(),
      title,
      icon: null,
      parentId: topicPlan.id,
      topic,
      subject,
      level: 1,
    };
    plans.push(plan);
    subjectPlans.push(plan);
    // Roughly three notes per subject, fewer for small workspaces.
    const notes = total < 60 ? 1 : 2 + Math.floor(random() * 3);
    for (let n = 0; n < notes && plans.length < total; n += 1) {
      const facet = topic.facets[(n + round) % topic.facets.length] ?? 'notes';
      plans.push({
        id: nextId(),
        title: `${subject} ${facet}`,
        icon: null,
        parentId: plan.id,
        topic,
        subject,
        level: 2,
      });
    }
    round += 1;
  }

  // Links: mostly within the topic, preferring popular subjects (a scale-free-ish graph).
  const byTopic = new Map<Topic, Plan[]>();
  for (const plan of plans) {
    const list = byTopic.get(plan.topic) ?? [];
    list.push(plan);
    byTopic.set(plan.topic, list);
  }
  const popularity = new Map<string, number>();
  const chooseTarget = (from: Plan): Plan => {
    const sameTopic = random() < 0.9;
    const pool = sameTopic ? (byTopic.get(from.topic) ?? plans) : plans;
    // Weighted by (1 + popularity), sampled from a few candidates to stay fast.
    let best = pick(random, pool);
    let bestWeight = -1;
    for (let i = 0; i < 4; i += 1) {
      const candidate = pick(random, pool);
      const weight =
        (1 + (popularity.get(candidate.id) ?? 0)) * (candidate.level === 1 ? 2 : 1) * random();
      if (weight > bestWeight) {
        best = candidate;
        bestWeight = weight;
      }
    }
    return best;
  };

  for (const plan of plans) {
    const topic = plan.topic;
    const others = byTopic.get(topic) ?? plans;
    const otherSubject = () => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const subject = pick(random, others).subject;
        if (subject !== plan.subject) return subject;
      }
      return topic.name;
    };
    const number = () => String(2 + Math.floor(random() * 97));
    // Facts come from a shuffled deck, so a page never repeats one until it used them all.
    let deck: string[] = [];
    const nextFact = (): string => {
      if (deck.length === 0) {
        deck = [...topic.facts];
        for (let i = deck.length - 1; i > 0; i -= 1) {
          const j = Math.floor(random() * (i + 1));
          [deck[i], deck[j]] = [deck[j] ?? '', deck[i] ?? ''];
        }
      }
      return deck.pop() ?? '';
    };
    const sentence = (target: Plan | null): InlineJSON[] => {
      const template = nextFact();
      const other = otherSubject();
      const text = fill(template, { subject: plan.subject, other, number: number() });
      if (!target) return [b.text(text)];
      return [b.text(`${text} See `), b.pageLink(target.id), b.text('.')];
    };
    const blocks: BlockJSON[] = [];
    const links = plan.level === 0 ? 0 : 1 + Math.floor(random() * (plan.level === 1 ? 4 : 3));
    const targets: Plan[] = [];
    for (let i = 0; i < links; i += 1) {
      const target = chooseTarget(plan);
      if (target.id !== plan.id) {
        targets.push(target);
        popularity.set(target.id, (popularity.get(target.id) ?? 0) + 1);
      }
    }
    if (plan.level === 0) {
      blocks.push(
        b.paragraph(`Everything about ${topic.name.toLowerCase()}, collected over the years.`),
      );
      blocks.push(
        b.callout(
          { emoji: plan.icon ?? '💡', tone: 'info' },
          b.paragraph(`Start with the subject pages below, then follow the links.`),
        ),
      );
    } else {
      if (plan.level === 1) blocks.push(b.heading(2, 'Overview'));
      const paragraphs = 1 + Math.floor(random() * 3);
      for (let p = 0; p < paragraphs; p += 1) {
        const target = targets[p] ?? null;
        const inline: InlineJSON[] = [...sentence(target)];
        inline.push(
          b.text(
            ` ${fill(nextFact(), { subject: plan.subject, other: otherSubject(), number: number() })}`,
          ),
        );
        if (random() < 0.35) inline.push(b.text(' '), b.tag(topic.tag));
        blocks.push(b.paragraph(...inline));
      }
      const fact = () =>
        fill(nextFact(), {
          subject: plan.subject,
          other: otherSubject(),
          number: number(),
        });
      if (random() < (plan.level === 1 ? 0.9 : 0.55)) {
        const count = plan.level === 1 ? 3 : 2 + Math.floor(random() * 2);
        blocks.push(b.heading(3, plan.level === 1 ? 'Key facts' : 'Notes'));
        blocks.push(
          b.bulletList(...Array.from({ length: count }, () => b.listItem(b.paragraph(fact())))),
        );
      }
      if (random() < 0.12) blocks.push(b.blockquote(b.paragraph(fact())));
      const related = targets.slice(paragraphs);
      if (related.length) {
        blocks.push(
          b.bulletList(
            ...related.map((target) => b.listItem(b.paragraph('Related: ', b.pageLink(target.id)))),
          ),
        );
      }
      if (random() < 0.25) {
        blocks.push(b.heading(3, 'Next steps'));
        blocks.push(
          b.taskList(
            ...topic.tasks
              .slice(0, 1 + Math.floor(random() * topic.tasks.length))
              .map((task) => b.taskItem(random() < 0.4, task)),
          ),
        );
      }
      if (random() < 0.06) {
        blocks.push(
          b.table(
            { header: true },
            ['Item', 'Status', 'Notes'],
            [plan.subject, 'In progress', `Compare with ${otherSubject()}`],
            [otherSubject(), 'Done', 'Logged last week'],
          ),
        );
      }
      if (random() < 0.05) {
        blocks.push(
          b.toggle('More details', [
            b.paragraph(
              fill(nextFact(), {
                subject: plan.subject,
                other: otherSubject(),
                number: number(),
              }),
            ),
          ]),
        );
      }
      if (topic.tag === 'ml' && random() < 0.2) {
        blocks.push(
          b.codeBlock(`loss = train(model, data, lr=${(random() / 100).toFixed(4)})`, 'python'),
        );
      }
    }
    const tags = new Set<string>();
    if (plan.level === 0 || random() < 0.85) tags.add(topic.tag);
    if (random() < 0.18) tags.add(pick(random, EXTRA_TAGS));
    if (random() < 0.08) tags.add(`${topic.tag}/${pick(random, ['archive', 'active', 'someday'])}`);
    const alias =
      plan.level === 1 && plan.title === plan.subject ? ALIASES[plan.subject] : undefined;
    pages.push({
      id: plan.id,
      title: plan.title,
      icon: plan.icon,
      parentId: plan.parentId,
      doc: b.doc(...(blocks.length ? blocks : [b.paragraph()])),
      tags: [...tags],
      aliases: alias ? [alias] : [],
      ageDays: Math.floor(random() ** 2 * 400),
    });
  }
  return { seed, pages };
}

/** Queries a person would type, for the benchmark (words, prefixes, typos, filters). */
export function benchmarkQueries(random: () => number, count: number): string[] {
  const words = TOPICS.flatMap((topic) => [...topic.subjects, topic.name, ...topic.facets]).flatMap(
    (phrase) => phrase.split(/\s+/),
  );
  const queries: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const word = pick(random, words).replace(/[^\p{L}\p{N}]/gu, '');
    if (!word) continue;
    const kind = i % 6;
    if (kind === 0) queries.push(word);
    else if (kind === 1) queries.push(word.slice(0, Math.max(2, Math.ceil(word.length / 2))));
    else if (kind === 2 && word.length > 4) queries.push(`${word.slice(0, 2)}${word.slice(3)}`);
    else if (kind === 3) queries.push(`${word} ${pick(random, words)}`);
    else if (kind === 4) queries.push(`${word} tag:${pick(random, TOPICS).tag}`);
    else queries.push(`${word.slice(0, 3)}`);
  }
  return queries;
}

/** Every prefix of a phrase, as typed one keystroke at a time ("k", "ky", "kyo"…). */
export function keystrokes(phrase: string): string[] {
  return Array.from({ length: phrase.length }, (_, i) => phrase.slice(0, i + 1)).filter(
    (prefix) => prefix.trim().length > 0,
  );
}
