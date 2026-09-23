import { describe, expect, it } from 'vitest';
import { build as b } from './builders';
import { FIXTURE_IDS, kitchenSinkDoc } from './fixtures';
import {
  extractAssetIds,
  extractEmbeds,
  extractHeadings,
  extractImages,
  extractLinks,
  extractPlainText,
  extractTags,
  extractTasks,
  extractTextBlocks,
  inlineText,
} from './extract';
import { headingSlug } from './slug';
import { readDocJSON, createDocFromJSON } from './ydoc';

const titles: Record<string, string> = {
  [FIXTURE_IDS.spec]: 'Mission spec',
  [FIXTURE_IDS.roadmap]: 'Roadmap',
  [FIXTURE_IDS.apollo]: 'Apollo program',
};
const resolveTitle = (id: string) => titles[id];

describe('inlineText', () => {
  it('renders every inline node', () => {
    expect(
      inlineText(
        [
          b.text('See '),
          b.pageLink(FIXTURE_IDS.spec),
          b.text(' and '),
          b.pageLink(FIXTURE_IDS.apollo, { label: 'Apollo' }),
          b.hardBreak(),
          b.tag('space'),
        ],
        { resolveTitle },
      ),
    ).toBe('See Mission spec and Apollo\n#space');
    expect(inlineText([b.pageLink('unknown-page')])).toBe('');
    expect(inlineText(undefined)).toBe('');
  });
});

describe('extractTextBlocks and extractPlainText', () => {
  it('lists every text block with containers and inherited block IDs', () => {
    const doc = b.doc(
      b.heading(2, 'Title'),
      { ...b.bulletList(b.listItem(b.paragraph('item'), b.bulletList('nested'))) },
      {
        type: 'callout',
        attrs: { blockId: 'callout-1' },
        content: [b.paragraph('inside callout')],
      },
      b.table({ header: true }, ['H1', 'H2'], ['c1', 'c2']),
      b.toggle('summary', ['body']),
      b.codeBlock('let x = 1;'),
      b.image({ src: 'https://x.io/a.png', alt: 'not text' }),
    );
    const blocks = extractTextBlocks(doc);
    expect(blocks.map((block) => block.text)).toEqual([
      'Title',
      'item',
      'nested',
      'inside callout',
      'H1',
      'H2',
      'c1',
      'c2',
      'summary',
      'body',
      'let x = 1;',
    ]);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 2, path: [0], containers: [] });
    expect(blocks[2]).toMatchObject({
      path: [1, 0, 1, 0, 0],
      containers: ['bulletList', 'listItem', 'bulletList', 'listItem'],
    });
    expect(blocks[3]).toMatchObject({ blockId: 'callout-1', containers: ['callout'] });
    expect(blocks[8]?.type).toBe('toggleSummary');
    expect(blocks[10]?.type).toBe('codeBlock');
    expect(extractPlainText(doc)).toBe(
      'Title\nitem\nnested\ninside callout\nH1\nH2\nc1\nc2\nsummary\nbody\nlet x = 1;',
    );
  });

  it('extracts the kitchen sink with unicode intact', () => {
    const text = extractPlainText(kitchenSinkDoc(), { resolveTitle });
    expect(text).toContain('Read the Mission spec first');
    expect(text).toContain('Unicode: 日本語テキスト, العربية, Ελληνικά, é, 👩‍🚀');
    expect(text).toContain('#space/history #apollo');
    expect(extractPlainText(b.doc())).toBe('');
  });
});

describe('extractHeadings', () => {
  it('returns the outline with slugs', () => {
    const doc = b.doc(
      b.heading(1, 'Launch Plan: Q3!'),
      'text',
      b.heading(3, 'Überblick & Ziele'),
      b.toggle('not a heading'),
    );
    expect(extractHeadings(doc)).toEqual([
      { level: 1, text: 'Launch Plan: Q3!', slug: 'launch-plan-q3', path: [0], blockId: null },
      { level: 3, text: 'Überblick & Ziele', slug: 'überblick-ziele', path: [2], blockId: null },
    ]);
    expect(headingSlug('  Multiple   spaces -- dashes ')).toBe('multiple-spaces-dashes');
  });
});

describe('extractLinks', () => {
  it('finds links in every container with their block context', () => {
    const links = extractLinks(kitchenSinkDoc(), { resolveTitle });
    const byContext = links.map((link) => [link.targetPageId, link.blockText]);
    expect(byContext).toEqual([
      [
        FIXTURE_IDS.spec,
        'Read the Mission spec first, then bold, italic, underline, strike, code(), a link and highlighted.\nTags: #space/history #apollo',
      ],
      [FIXTURE_IDS.apollo, 'Neil Armstrong, see the landing'],
      [FIXTURE_IDS.roadmap, 'Commander Roadmap'],
      [FIXTURE_IDS.spec, 'Pack the Mission spec'],
      [FIXTURE_IDS.apollo, 'That’s one small step for man Apollo program'],
      [FIXTURE_IDS.roadmap, 'Fuel low: Roadmap'],
      [FIXTURE_IDS.spec, 'Michael Mission spec'],
      [FIXTURE_IDS.roadmap, 'Details with Roadmap'],
      [FIXTURE_IDS.apollo, 'Hidden Apollo program'],
    ]);
    expect(links[1]).toMatchObject({
      label: 'the landing',
      heading: 'Descent',
      blockRef: null,
      offset: 20,
    });
    expect(links[2]).toMatchObject({ blockRef: 'step-1', label: null });
    expect(links[0]?.offset).toBe(9);
  });

  it('works on documents read back from Yjs', () => {
    const doc = readDocJSON(
      createDocFromJSON(b.doc(b.paragraph('self link ', b.pageLink(FIXTURE_IDS.spec)))),
    );
    expect(extractLinks(doc).map((link) => link.targetPageId)).toEqual([FIXTURE_IDS.spec]);
  });
});

describe('extractTags, extractTasks, extractEmbeds, extractImages, extractAssetIds', () => {
  it('extracts tags with case-insensitive keys', () => {
    const tags = extractTags(
      b.doc(
        b.paragraph(b.tag('Project/Alpha'), ' and ', b.tag('project/alpha')),
        b.bulletList(b.listItem(b.paragraph(b.tag('ideas')))),
      ),
    );
    expect(tags.map((tag) => [tag.name, tag.key, tag.offset])).toEqual([
      ['Project/Alpha', 'project/alpha', 0],
      ['project/alpha', 'project/alpha', 6],
      ['ideas', 'ideas', 0],
    ]);
  });

  it('extracts nested tasks with depth', () => {
    const tasks = extractTasks(kitchenSinkDoc(), { resolveTitle });
    expect(tasks.map((task) => [task.text, task.checked, task.depth])).toEqual([
      ['Pack the Mission spec', true, 0],
      ['Subtask', false, 1],
      ['Return safely', false, 0],
    ]);
  });

  it('extracts embeds, images and asset IDs', () => {
    const doc = kitchenSinkDoc();
    expect(extractEmbeds(doc).map((embed) => embed.kind)).toEqual([
      'database',
      'web',
      'file',
      'plugin:mermaid/diagram',
    ]);
    expect(extractEmbeds(doc)[0]).toMatchObject({
      ref: FIXTURE_IDS.database,
      data: { viewId: FIXTURE_IDS.view },
    });
    expect(extractImages(doc).map((image) => [image.assetId, image.src])).toEqual([
      [FIXTURE_IDS.asset, null],
      [null, 'https://images.example.com/moon.png'],
    ]);
    expect(extractAssetIds(doc)).toEqual([FIXTURE_IDS.asset, FIXTURE_IDS.fileAsset]);
    expect(extractAssetIds(b.doc())).toEqual([]);
  });
});
