/**
 * Page content for generated workspaces, as canonical DocJSON built with core's `build` helpers.
 * Each page's content comes from its own random stream, so it doesn't depend on which pages were
 * generated before it.
 */
import {
  build,
  normalizeDocJSON,
  type BlockJSON,
  type DocJSON,
  type InlineJSON,
} from '@tessera/core';
import type { WorkspacePlan } from './plan';
import { Random } from './random';
import { capitalize, fill, sentence } from './text';
import type { PagePlan } from './types';
import {
  CALLOUTS,
  EXTERNAL_LINKS,
  GENERAL_TAGS,
  HEADINGS,
  LINK_PHRASES,
  PEOPLE,
  QUOTES,
  TASKS,
  TOPICS,
  type Topic,
} from './words';

type Inline = string | InlineJSON;

/** The text of the last block of a large page, so benchmarks can tell it has rendered. */
export function largePageEndMarker(page: PagePlan): string {
  return `End of ${page.title}.`;
}

function topicOf(page: PagePlan): Topic {
  return TOPICS.find((topic) => topic.id === page.topicId) ?? (TOPICS[0] as Topic);
}

/** Picks a page to link to: mostly from the same topic, always with a power law over popularity. */
function pickTarget(rng: Random, plan: WorkspacePlan, page: PagePlan): PagePlan | null {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const sameTopic = plan.linkTargetsByTopic.get(page.topicId) ?? [];
    const pool = sameTopic.length > 3 && rng.chance(0.6) ? sameTopic : plan.linkTargets;
    const target = pool[rng.zipf(pool.length, 1.05)];
    if (target && target.id !== page.id) return target;
  }
  return null;
}

class PageWriter {
  readonly blocks: BlockJSON[] = [];
  private readonly links: PagePlan[];
  private readonly rng: Random;
  private readonly topic: Topic;
  private readonly plan: WorkspacePlan;

  constructor(rng: Random, plan: WorkspacePlan, page: PagePlan, linkCount: number) {
    this.rng = rng;
    this.plan = plan;
    this.topic = topicOf(page);
    const links: PagePlan[] = [];
    for (let i = 0; i < linkCount; i += 1) {
      const target = pickTarget(rng, plan, page);
      if (target && !links.includes(target)) links.push(target);
    }
    this.links = links;
  }

  get pendingLinks(): number {
    return this.links.length;
  }

  private pageLink(target: PagePlan): InlineJSON {
    if (target.aliases.length && this.rng.chance(0.3)) {
      return build.pageLink(target.id, { label: target.aliases[0] ?? null });
    }
    return build.pageLink(target.id);
  }

  /** One sentence as inline nodes, sometimes with marks, a link or an external link. */
  private sentenceInline(): Inline[] {
    const rng = this.rng;
    const link = this.links.length && rng.chance(0.45) ? this.links.shift() : undefined;
    if (link) {
      const phrase = fill(rng.pick(LINK_PHRASES), rng, this.topic);
      const [before = '', after = ''] = phrase.split('{link}');
      return [capitalize(before), this.pageLink(link), after];
    }
    const text = sentence(rng.pick(this.topic.sentences), rng, this.topic);
    const roll = rng.next();
    if (roll < 0.08) {
      const label = rng.pick(['Decision:', 'Note:', 'Update:', 'Heads-up:']);
      return [build.text(label, build.mark.bold()), ` ${text}`];
    }
    if (roll < 0.14) return [build.text(text, build.mark.italic())];
    if (roll < 0.18)
      return [
        build.text(
          text,
          build.mark.highlight(
            rng.chance(0.5) ? null : rng.pick(['blue', 'green', 'pink'] as const),
          ),
        ),
      ];
    if (roll < 0.22) {
      const [label, href] = rng.pick(EXTERNAL_LINKS);
      return [`${text} More in `, build.text(label, build.mark.link(href)), '.'];
    }
    if (roll < 0.25 && this.topic.code) {
      return [
        `${text} Check it with `,
        build.text(
          rng.pick(['pnpm test', 'git bisect', 'EXPLAIN ANALYZE', 'curl -I']),
          build.mark.code(),
        ),
        '.',
      ];
    }
    if (roll < 0.27) {
      return [
        build.text(text, build.mark.strike()),
        ' ',
        build.text('Superseded.', build.mark.underline()),
      ];
    }
    return [text];
  }

  paragraph(sentences = this.rng.int(1, 3), withTag = false): BlockJSON {
    const inline: Inline[] = [];
    for (let i = 0; i < sentences; i += 1) {
      if (i > 0) inline.push(' ');
      inline.push(...this.sentenceInline());
    }
    if (withTag) {
      const pool = [...this.topic.tags, ...GENERAL_TAGS];
      inline.push(' ', build.tag(pool[this.rng.zipf(pool.length, 1.2)] ?? 'todo'));
    }
    const block = build.paragraph(...inline);
    return this.rng.chance(0.02)
      ? build.colored(
          block,
          this.rng.pick(['blue-background', 'yellow-background', 'gray'] as const),
        )
      : block;
  }

  heading(level: 1 | 2 | 3 = this.rng.chance(0.8) ? 2 : 3): BlockJSON {
    return build.heading(level, this.rng.pick(HEADINGS));
  }

  bulletList(): BlockJSON {
    const count = this.rng.int(2, 5);
    return build.bulletList(
      ...Array.from({ length: count }, () =>
        build.listItem(build.paragraph(...this.sentenceInline())),
      ),
    );
  }

  orderedList(): BlockJSON {
    const count = this.rng.int(3, 5);
    return build.orderedList(
      ...Array.from({ length: count }, () =>
        sentence(this.rng.pick(this.topic.sentences), this.rng, this.topic),
      ),
    );
  }

  taskList(): BlockJSON {
    const count = this.rng.int(2, 6);
    return build.taskList(
      ...Array.from({ length: count }, () =>
        build.taskItem(this.rng.chance(0.35), sentence(this.rng.pick(TASKS), this.rng, this.topic)),
      ),
    );
  }

  table(): BlockJSON {
    const rng = this.rng;
    if (this.topic.id === 'engineering' || rng.chance(0.3)) {
      const rows = Array.from({ length: rng.int(3, 5) }, () => {
        const before = rng.int(20, 400);
        return [
          capitalize(rng.pick(this.topic.nouns)),
          `${before} ms`,
          `${Math.round(before * (0.4 + rng.next() * 0.5))} ms`,
        ];
      });
      return build.table({ header: true }, ['Measure', 'Before', 'After'], ...rows);
    }
    const rows = Array.from({ length: rng.int(3, 5) }, () => [
      capitalize(rng.pick(this.topic.nouns)),
      rng.pick(PEOPLE),
      rng.pick(['Done', 'In progress', 'Blocked', 'Not started']),
    ]);
    return build.table({ header: true }, ['Item', 'Owner', 'Status'], ...rows);
  }

  callout(): BlockJSON {
    const entry = this.rng.pick(CALLOUTS);
    return build.callout(
      { emoji: entry.emoji, tone: entry.tone },
      sentence(entry.text, this.rng, this.topic),
    );
  }

  toggle(): BlockJSON {
    const summary = fill(
      this.rng.pick([
        'Details',
        'Raw notes from {weekday}',
        'Why not the {noun}',
        'Full transcript',
      ]),
      this.rng,
      this.topic,
    );
    return build.toggle(
      summary,
      [this.paragraph(), ...(this.rng.chance(0.4) ? [this.bulletList()] : [])],
      { open: this.rng.chance(0.2) },
    );
  }

  code(): BlockJSON {
    const code = this.topic.code;
    if (code) return build.codeBlock(this.rng.pick(code.snippets), code.language);
    return build.codeBlock(
      `{\n  "owner": "${this.rng.pick(PEOPLE)}",\n  "done": ${this.rng.chance(0.5)}\n}`,
      'json',
    );
  }

  quote(): BlockJSON {
    return build.blockquote(this.rng.pick(QUOTES));
  }

  databaseEmbed(): BlockJSON | null {
    if (!this.plan.databases.length) return null;
    const database = this.rng.pick(this.plan.databases);
    const view = this.rng.pick(database.views);
    return build.embed('database', database.id, { viewId: view.id });
  }

  /** Every link not placed yet, as a "Links" section. */
  flushLinks(): void {
    if (!this.links.length) return;
    this.blocks.push(build.heading(2, 'Links'));
    this.blocks.push(
      build.bulletList(
        ...this.links
          .splice(0)
          .map((target) => build.listItem(build.paragraph(this.pageLink(target)))),
      ),
    );
  }
}

const BLOCK_WEIGHTS = [
  ['paragraph', 46],
  ['bulletList', 10],
  ['taskList', 9],
  ['orderedList', 4],
  ['table', 5],
  ['callout', 6],
  ['toggle', 4],
  ['code', 4],
  ['quote', 3],
  ['rule', 2],
  ['database', 2],
] as const;

function ordinaryPage(writer: PageWriter, rng: Random, hasTagParagraph: boolean): void {
  const target = rng.int(4, 16);
  writer.blocks.push(writer.paragraph(rng.int(1, 3), hasTagParagraph));
  while (writer.blocks.length < target) {
    if (rng.chance(0.25)) writer.blocks.push(writer.heading());
    const kind = rng.weighted(BLOCK_WEIGHTS);
    switch (kind) {
      case 'paragraph':
        writer.blocks.push(writer.paragraph(undefined, rng.chance(0.1)));
        break;
      case 'bulletList':
        writer.blocks.push(writer.bulletList());
        break;
      case 'taskList':
        writer.blocks.push(writer.taskList());
        break;
      case 'orderedList':
        writer.blocks.push(writer.orderedList());
        break;
      case 'table':
        writer.blocks.push(writer.table());
        break;
      case 'callout':
        writer.blocks.push(writer.callout());
        break;
      case 'toggle':
        writer.blocks.push(writer.toggle());
        break;
      case 'code':
        writer.blocks.push(writer.code());
        break;
      case 'quote':
        writer.blocks.push(writer.quote());
        break;
      case 'rule':
        writer.blocks.push(build.horizontalRule());
        break;
      case 'database': {
        const embed = writer.databaseEmbed();
        if (embed) writer.blocks.push(embed);
        break;
      }
    }
  }
  writer.flushLinks();
}

function largePage(writer: PageWriter, rng: Random, page: PagePlan): void {
  const count = page.blockCount ?? 1;
  for (let i = 0; i < count - 1; i += 1) {
    if (i % 25 === 0) writer.blocks.push(build.heading(2, `Part ${i / 25 + 1}`));
    else if (i % 10 === 5) writer.blocks.push(writer.bulletList());
    else if (i % 40 === 17) writer.blocks.push(writer.taskList());
    else writer.blocks.push(writer.paragraph(rng.int(1, 2)));
  }
  writer.blocks.push(build.paragraph(largePageEndMarker(page)));
}

/**
 * The content of a page as normalized DocJSON, or null for pages without a body (databases, and
 * rows that only have property values).
 */
export function generatePageContent(plan: WorkspacePlan, page: PagePlan): DocJSON | null {
  if (page.role === 'database') return null;
  if (page.role === 'row' && !page.hasBody) return null;
  const rng = new Random(`${String(plan.options.seed)}/content/${page.id}`);
  if (page.role === 'row') {
    const writer = new PageWriter(rng, plan, page, 0);
    writer.blocks.push(writer.paragraph(2));
    if (rng.chance(0.6)) writer.blocks.push(writer.taskList());
    return normalizeDocJSON(build.doc(...writer.blocks));
  }
  const linkCount =
    page.role === 'large'
      ? Math.ceil((page.blockCount ?? 0) / 15)
      : Math.min(12, rng.geometric(plan.options.linksPerPage));
  const writer = new PageWriter(rng, plan, page, linkCount);
  if (page.role === 'large') largePage(writer, rng, page);
  else ordinaryPage(writer, rng, page.tags.length === 0 && rng.chance(0.4));
  return normalizeDocJSON(build.doc(...writer.blocks));
}
