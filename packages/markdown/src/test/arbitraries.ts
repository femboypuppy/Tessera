import {
  BLOCK_COLORS,
  CALLOUT_TONES,
  TEXT_COLORS,
  normalizeDocJSON,
  type AnyNodeJSON,
  type DocJSON,
} from '@tessera/core';
import fc from 'fast-check';
import { autolinkText } from '../to-doc';

/** Pages the generated links point to: id → title. */
export const PAGES: Readonly<Record<string, string>> = {
  'page-apollo-0000000001': 'Apollo 11',
  'page-gemini-0000000002': 'Gemini: program notes',
  'page-launch-0000000003': 'Launch plan',
  'page-unicode-000000004': 'Café crème ☕',
};
export const PAGE_IDS = Object.keys(PAGES);

/** Resolvers matching {@link PAGES}, as an importer and an exporter would use them. */
export const resolvers = {
  resolvePage: (pageId: string) => (PAGES[pageId] ? { title: PAGES[pageId] } : null),
  resolvePageLink: (target: string) =>
    PAGE_IDS.find((id) => PAGES[id]?.toLowerCase() === target.toLowerCase()) ?? null,
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SAFE_WORD = fc.stringMatching(/^[A-Za-z][A-Za-z0-9]{0,7}$/);

/** Characters that mean something in markdown (and in Obsidian's dialect). */
const SPECIAL = [...'*_`[]()#!=^~\\<>&|:;.,-+"\'/%{}$@'];
const UNICODE = ['é', 'ß', '日本', 'Ω', '→', '—', '👩‍🚀', '🚀', '\u00a0'];

const textChar = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom(...LETTERS) },
  { weight: 2, arbitrary: fc.constantFrom(' ', ' ', '0', '7') },
  { weight: 3, arbitrary: fc.constantFrom(...SPECIAL) },
  { weight: 1, arbitrary: fc.constantFrom(...UNICODE) },
);

/**
 * Arbitrary plain text (one line, never empty). Text that GFM would turn into a link (bare URLs
 * and emails) is excluded: parsing links it, by design.
 */
export const plainText = fc
  .array(textChar, { minLength: 1, maxLength: 14 })
  .map((chars) => chars.join(''))
  .filter((value) => autolinkText(value).every((part) => part.href === null));

const href = fc.constantFrom(
  'https://example.com',
  'https://example.com/a_b?c=1&d=2#frag',
  'mailto:ada@example.com',
  'https://en.wikipedia.org/wiki/Apollo_(program)',
  '/relative/path',
  '#anchor',
);

const simpleMark = fc.constantFrom('bold', 'italic', 'underline', 'strike');

const markSet = fc
  .record({
    simple: fc.uniqueArray(simpleMark, { maxLength: 3 }),
    highlight: fc.option(fc.option(fc.constantFrom(...TEXT_COLORS), { nil: null }), {
      nil: undefined,
    }),
    link: fc.option(href, { nil: undefined }),
    code: fc.boolean(),
  })
  .map(({ simple, highlight, link, code }) => {
    if (code) return [{ type: 'code' }];
    const marks: Array<{ type: string; attrs?: Record<string, unknown> }> = simple.map((type) => ({
      type,
    }));
    if (highlight !== undefined) marks.push({ type: 'highlight', attrs: { color: highlight } });
    if (link) marks.push({ type: 'link', attrs: { href: link, title: null } });
    return marks;
  });

const textNode = fc
  .record({ text: plainText, marks: fc.option(markSet, { nil: undefined, freq: 2 }) })
  .map(({ text, marks }): AnyNodeJSON =>
    marks?.length ? { type: 'text', text, marks } : { type: 'text', text },
  );

const pageLinkNode = fc
  .record({
    pageId: fc.constantFrom(...PAGE_IDS),
    label: fc.option(
      plainText.map((value) => value.trim()).filter((value) => value.length > 0),
      { nil: null, freq: 3 },
    ),
    heading: fc.option(SAFE_WORD, { nil: null, freq: 4 }),
    blockRef: fc.option(fc.stringMatching(/^[a-z0-9]{1,8}$/), { nil: null, freq: 5 }),
  })
  .map((attrs): AnyNodeJSON => ({
    type: 'pageLink',
    attrs: { ...attrs, heading: attrs.blockRef ? null : attrs.heading },
  }));

const tagNode = fc
  .stringMatching(/^[a-zA-Zé][a-zA-Z0-9_-]{0,6}(\/[a-z][a-z0-9]{0,4})?$/)
  .map((name): AnyNodeJSON => ({ type: 'tag', attrs: { name } }));

const inlineAtom = fc.oneof(
  { weight: 8, arbitrary: textNode },
  { weight: 2, arbitrary: pageLinkNode },
  { weight: 1, arbitrary: tagNode },
  { weight: 1, arbitrary: fc.constant<AnyNodeJSON>({ type: 'hardBreak' }) },
);

/**
 * Makes inline content representable: tags need whitespace on both sides (Obsidian's rule), and
 * hard breaks cannot start or end a block (markdown trims them).
 */
function fixInline(nodes: AnyNodeJSON[]): AnyNodeJSON[] {
  const result: AnyNodeJSON[] = [];
  for (const node of nodes) {
    if (node.type === 'tag') {
      const previous = result[result.length - 1];
      if (previous?.type === 'text' || previous?.type === 'pageLink' || previous?.type === 'tag')
        result.push({ type: 'text', text: ' ' });
      result.push(node);
      result.push({ type: 'text', text: ' ' });
      continue;
    }
    result.push(node);
  }
  while (result[0]?.type === 'hardBreak') result.shift();
  while (result[result.length - 1]?.type === 'hardBreak') result.pop();
  return result;
}

export const inlineContent = fc
  .array(inlineAtom, { minLength: 1, maxLength: 6 })
  .map(fixInline)
  .filter((nodes) => nodes.length > 0);

const blockColor = fc.option(fc.constantFrom(...BLOCK_COLORS), { nil: null, freq: 4 });
const blockId = fc.option(fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,7}$/), { nil: null, freq: 4 });

const paragraph = fc
  .record({
    content: fc.option(inlineContent, { nil: undefined, freq: 8 }),
    color: blockColor,
    blockId,
  })
  .map(({ content, color, blockId: id }): AnyNodeJSON => {
    const node: AnyNodeJSON = { type: 'paragraph', attrs: { color, blockId: id } };
    if (content) node.content = content;
    return node;
  });

const heading = fc
  .record({
    level: fc.constantFrom(1, 2, 3),
    content: fc.option(inlineContent, { nil: undefined, freq: 8 }),
    color: blockColor,
    blockId,
  })
  .map(({ level, content, color, blockId: id }): AnyNodeJSON => {
    const node: AnyNodeJSON = { type: 'heading', attrs: { level, color, blockId: id } };
    if (content) node.content = content;
    return node;
  });

const codeBlock = fc
  .record({
    language: fc.option(fc.constantFrom('typescript', 'python', 'c++', 'objective-c', 'mermaid'), {
      nil: null,
    }),
    code: fc.option(
      fc
        .array(
          fc.oneof(plainText, fc.constantFrom('```', '    indented', '', '~~~', '</details>')),
          { minLength: 1, maxLength: 4 },
        )
        .map((lines) => lines.join('\n')),
      { nil: '' },
    ),
    blockId,
  })
  .map(({ language, code, blockId: id }): AnyNodeJSON => {
    const node: AnyNodeJSON = { type: 'codeBlock', attrs: { language, blockId: id } };
    if (code) node.content = [{ type: 'text', text: code }];
    return node;
  });

const image = fc
  .record({
    source: fc.oneof(
      fc.constant({ assetId: 'f'.repeat(64) }),
      fc.constantFrom(
        { src: 'https://images.example.com/moon.png' },
        { src: 'https://example.com/a%20b.jpg' },
      ),
    ),
    alt: fc.option(fc.stringMatching(/^[A-Za-z][A-Za-z ,.]{0,12}[A-Za-z.]$/), { nil: null }),
    title: fc.option(plainText.map((value) => value.trim()).filter(Boolean), { nil: null }),
    width: fc.option(fc.integer({ min: 10, max: 100 }), { nil: null }),
    blockId,
  })
  .map(({ source, ...rest }): AnyNodeJSON => ({ type: 'image', attrs: { ...source, ...rest } }));

const embed = fc.oneof(
  fc
    .record({ viewId: fc.option(fc.constant('view-000000000000000001'), { nil: null }) })
    .map((data): AnyNodeJSON => ({
      type: 'embed',
      attrs: { kind: 'database', ref: 'database-000000000000001', data },
    })),
  fc.constantFrom<AnyNodeJSON>(
    {
      type: 'embed',
      attrs: {
        kind: 'web',
        ref: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        data: { display: 'embed' },
      },
    },
    {
      type: 'embed',
      attrs: {
        kind: 'web',
        ref: 'https://vimeo.com/76979871',
        data: { display: 'embed', title: 'Vimeo talk' },
      },
    },
    {
      type: 'embed',
      attrs: {
        kind: 'web',
        ref: 'https://example.com/post',
        data: { display: 'bookmark', title: 'A post', description: 'Summary' },
      },
    },
    {
      type: 'embed',
      attrs: {
        kind: 'file',
        ref: 'e'.repeat(64),
        data: { name: 'plan.pdf', size: 2048, mimeType: 'application/pdf' },
      },
    },
    {
      type: 'embed',
      attrs: {
        kind: 'plugin:mermaid/diagram',
        ref: null,
        data: { source: 'graph TD; A-->B', nested: [1, 'two', { three: true }] },
      },
    },
  ),
  blockId.map((id): AnyNodeJSON => ({
    type: 'embed',
    attrs: { kind: 'plugin:kanban/board', ref: null, data: null, blockId: id },
  })),
);

const cellParagraphs = fc
  .array(
    fc.option(
      // Two breaks in a row separate paragraphs in a cell (`<br><br>`).
      inlineContent.map((content) =>
        content.filter(
          (node, index) => node.type !== 'hardBreak' || content[index - 1]?.type !== 'hardBreak',
        ),
      ),
      { nil: undefined, freq: 5 },
    ),
    { minLength: 1, maxLength: 2 },
  )
  .map((paragraphs) =>
    paragraphs.map((content): AnyNodeJSON =>
      content?.length ? { type: 'paragraph', content } : { type: 'paragraph' },
    ),
  );

const table = fc
  .record({
    columns: fc.integer({ min: 1, max: 3 }),
    rows: fc.integer({ min: 1, max: 3 }),
    header: fc.boolean(),
    cells: fc.array(cellParagraphs, { minLength: 9, maxLength: 9 }),
    blockId,
  })
  .map(({ columns, rows, header, cells, blockId: id }): AnyNodeJSON => ({
    type: 'table',
    attrs: { blockId: id },
    content: Array.from({ length: rows }, (_, row) => ({
      type: 'tableRow',
      content: Array.from({ length: columns }, (_, column) => ({
        type: header && row === 0 ? 'tableHeader' : 'tableCell',
        content: cells[row * 3 + column] ?? [{ type: 'paragraph' }],
      })),
    })),
  }));

const EMOJI = ['💡', '⚠️', '🚀', '📌', 'ℹ️', '✅', '🔥', null] as const;

function blockArbitrary(depth: number): fc.Arbitrary<AnyNodeJSON> {
  const leaf = fc.oneof(
    { weight: 6, arbitrary: paragraph },
    { weight: 2, arbitrary: heading },
    { weight: 1, arbitrary: codeBlock },
    { weight: 1, arbitrary: fc.constant<AnyNodeJSON>({ type: 'horizontalRule' }) },
    { weight: 1, arbitrary: image },
    { weight: 1, arbitrary: embed },
    { weight: 1, arbitrary: table },
  );
  if (depth <= 0) return leaf;
  const inner = fc.array(blockArbitrary(depth - 1), { minLength: 1, maxLength: 3 });
  const listItem = (type: 'listItem' | 'taskItem') =>
    fc
      .record({
        first: fc.option(inlineContent, { nil: undefined, freq: 6 }),
        firstColor: blockColor,
        rest: fc.option(fc.array(blockArbitrary(depth - 1), { minLength: 1, maxLength: 2 }), {
          nil: undefined,
          freq: 3,
        }),
        color: blockColor,
        blockId,
        checked: fc.boolean(),
      })
      .map(({ first, firstColor, rest, color, blockId: id, checked }): AnyNodeJSON => {
        const firstParagraph: AnyNodeJSON = { type: 'paragraph', attrs: { color: firstColor } };
        if (first) firstParagraph.content = first;
        const attrs: Record<string, unknown> = { color, blockId: id };
        if (type === 'taskItem') attrs.checked = checked;
        return { type, attrs, content: [firstParagraph, ...(rest ?? [])] };
      });
  return fc.oneof(
    { weight: 8, arbitrary: leaf },
    {
      weight: 1,
      arbitrary: fc
        .record({ content: inner, color: blockColor, blockId })
        .map(({ content, color, blockId: id }): AnyNodeJSON => ({
          type: 'blockquote',
          attrs: { color, blockId: id },
          content,
        })),
    },
    {
      weight: 1,
      arbitrary: fc
        .record({
          content: inner,
          tone: fc.constantFrom(...CALLOUT_TONES),
          emoji: fc.constantFrom(...EMOJI),
          blockId,
        })
        .map(({ content, tone, emoji, blockId: id }): AnyNodeJSON => ({
          type: 'callout',
          attrs: { tone, emoji, blockId: id },
          content,
        })),
    },
    {
      weight: 1,
      arbitrary: fc
        .record({
          type: fc.constantFrom('bulletList', 'orderedList'),
          items: fc.array(listItem('listItem'), { minLength: 1, maxLength: 3 }),
          start: fc.integer({ min: 0, max: 20 }),
        })
        .map(({ type, items, start }): AnyNodeJSON =>
          type === 'orderedList'
            ? { type, attrs: { start }, content: items }
            : { type, content: items },
        ),
    },
    {
      weight: 1,
      arbitrary: fc
        .array(listItem('taskItem'), { minLength: 1, maxLength: 3 })
        .map((items): AnyNodeJSON => ({ type: 'taskList', content: items })),
    },
    {
      weight: 1,
      arbitrary: fc
        .record({
          summary: fc.option(inlineContent, { nil: undefined, freq: 5 }),
          rest: fc.array(blockArbitrary(depth - 1), { maxLength: 2 }),
          open: fc.boolean(),
          color: blockColor,
          blockId,
        })
        .map(({ summary, rest, open, color, blockId: id }): AnyNodeJSON => ({
          type: 'toggle',
          attrs: { open, color, blockId: id },
          content: [
            summary ? { type: 'toggleSummary', content: summary } : { type: 'toggleSummary' },
            ...rest,
          ],
        })),
    },
  );
}

/** Removes what markdown cannot hold by design (see the codec's documentation). */
function representable(doc: DocJSON): DocJSON {
  const json = structuredClone(doc) as unknown as AnyNodeJSON;
  const visit = (node: AnyNodeJSON) => {
    if (node.type === 'listItem' || node.type === 'taskItem') {
      // A list item's first line carries the item's block ID, not its paragraph's.
      const first = node.content?.[0];
      if (first?.attrs) first.attrs = { ...first.attrs, blockId: null };
    }
    node.content?.forEach(visit);
  };
  visit(json);
  // Trailing empty paragraphs are editor chrome, not content.
  const blocks = json.content ?? [];
  while (blocks.length > 1) {
    const last = blocks[blocks.length - 1];
    if (
      last?.type !== 'paragraph' ||
      last.content?.length ||
      last.attrs?.color ||
      last.attrs?.blockId
    )
      break;
    blocks.pop();
  }
  return normalizeDocJSON(json);
}

/** Arbitrary documents covering every node, mark and attribute of the schema. */
export const docArbitrary: fc.Arbitrary<DocJSON> = fc
  .array(blockArbitrary(2), { minLength: 1, maxLength: 6 })
  .map((content) => representable(normalizeDocJSON({ type: 'doc', content })))
  .filter(
    (doc) =>
      !(
        doc.content.length === 1 &&
        doc.content[0]?.type === 'paragraph' &&
        !doc.content[0].content
      ),
  );

const markdownLine = fc.oneof(
  plainText,
  fc.constantFrom(
    '# Heading',
    '### Deep heading',
    '#### Deeper',
    '- item',
    '  - nested',
    '1. one',
    '3) three',
    '- [ ] todo',
    '- [x] done',
    '> quote',
    '> [!warning] Careful',
    '> [!faq]- Why?',
    '> [!note|🚀]',
    '```js',
    '```',
    '~~~',
    '    indented code',
    '| a | b |',
    '| - | - |',
    '| [[Apollo 11\\|alias]] | c |',
    '---',
    '***',
    '===',
    '',
    '',
    '<details>',
    '<summary>More</summary>',
    '</details>',
    '<u>under</u> and <mark>marked</mark>',
    '<div>block html</div>',
    '<script>alert(1)</script>',
    '[[Apollo 11]]',
    '[[Launch plan#Countdown|the countdown]]',
    '[[Missing page]]',
    '![[diagram.png]]',
    '#tag and #nested/tag',
    '==highlight== text',
    'text ^block-1',
    '^standalone',
    '[link](https://example.com)',
    '[relative](Launch%20plan.md)',
    '[bad](javascript:alert(1))',
    '![img](https://example.com/x.png "title")',
    '**bold** *italic* ~~strike~~ `code`',
    '\\*not emphasis\\*',
    '&amp; &nbsp; &#x41;',
    '[^1]',
    '[^1]: footnote',
    '<!--color:red-->',
    '%%comment%%',
  ),
);

/** Arbitrary markdown-ish sources mixing every construct, valid or broken. */
export const markdownArbitrary = fc
  .array(markdownLine, { minLength: 1, maxLength: 12 })
  .map((lines) => lines.join('\n'));
