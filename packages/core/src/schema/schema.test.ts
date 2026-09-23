import { Schema } from 'prosemirror-model';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ValidationError } from '../errors';
import { build as b } from './builders';
import { describeSchema, diffSchemaDescriptions, SCHEMA_DESCRIPTION } from './description';
import {
  docJSONEqual,
  emptyDocJSON,
  isDocEmpty,
  isSafeHref,
  isSafeImageSrc,
  nodeAtPath,
  normalizeDocJSON,
  validateDocJSON,
  walkDocJSON,
} from './docjson';
import { FIXTURE_IDS, kitchenSinkDoc } from './fixtures';
import { markSpecs, MARK_NAMES, nodeSpecs, NODE_NAMES, tesseraSchema } from './schema';
import { createDocFromJSON, readDocJSON, updateDocJSON, writeDocJSON } from './ydoc';

function typesIn(doc: unknown): { nodes: Set<string>; marks: Set<string> } {
  const nodes = new Set<string>();
  const marks = new Set<string>();
  walkDocJSON(doc as never, (node) => {
    nodes.add(node.type);
    for (const mark of node.marks ?? []) marks.add(mark.type);
  });
  return { nodes, marks };
}

function sync(a: Y.Doc, b2: Y.Doc): void {
  Y.applyUpdate(b2, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b2)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b2, Y.encodeStateVector(a)));
}

describe('schema description', () => {
  it('matches the checked-in machine-readable description', async () => {
    await expect(`${JSON.stringify(SCHEMA_DESCRIPTION, null, 2)}\n`).toMatchFileSnapshot(
      './schema-description.json',
    );
  });

  it('covers every node and mark', () => {
    expect(Object.keys(SCHEMA_DESCRIPTION.nodes).sort()).toEqual([...NODE_NAMES].sort());
    expect(Object.keys(SCHEMA_DESCRIPTION.marks).sort()).toEqual([...MARK_NAMES].sort());
    expect(SCHEMA_DESCRIPTION.nodes.tableRow?.content).toBe('(tableCell | tableHeader)*');
    expect(SCHEMA_DESCRIPTION.nodes.bulletList?.groups).toEqual(['block', 'list']);
    expect(SCHEMA_DESCRIPTION.marks.code?.excludes).toBe('_');
    expect(SCHEMA_DESCRIPTION.marks.link?.inclusive).toBe(false);
  });

  it('reports every difference against another schema', () => {
    const { paragraph, ...rest } = nodeSpecs;
    const other = new Schema({
      nodes: {
        ...rest,
        paragraph: { ...paragraph, attrs: { ...paragraph.attrs, textAlign: { default: 'left' } } },
        heading: { ...nodeSpecs.heading, content: 'text*' },
        mystery: { group: 'block' },
      },
      marks: { ...markSpecs, link: { attrs: { href: {} }, inclusive: true }, superscript: {} },
    });
    const issues = diffSchemaDescriptions(SCHEMA_DESCRIPTION, describeSchema(other));
    expect(issues).toEqual(
      expect.arrayContaining([
        'node "paragraph": unexpected attribute "textAlign"',
        'node "heading": content expected "inline*", got "text*"',
        'unexpected node "mystery"',
        'mark "link": inclusive expected false, got true',
        'unexpected mark "superscript"',
        'mark "link": missing attribute "title"',
      ]),
    );
    expect(diffSchemaDescriptions(SCHEMA_DESCRIPTION, describeSchema(tesseraSchema))).toEqual([]);
  });

  it('normalizes whitespace in content expressions', () => {
    const spaced = new Schema({
      nodes: {
        ...nodeSpecs,
        tableRow: { ...nodeSpecs.tableRow, content: '( tableCell|tableHeader ) *' },
      },
      marks: markSpecs,
    });
    expect(describeSchema(spaced).nodes.tableRow?.content).toBe('(tableCell | tableHeader) *');
  });
});

describe('kitchen sink document', () => {
  it('uses every node and mark, and is valid', () => {
    const doc = kitchenSinkDoc();
    const { nodes, marks } = typesIn(doc);
    expect([...nodes].sort()).toEqual([...NODE_NAMES].sort());
    expect([...marks].sort()).toEqual([...MARK_NAMES].sort());
    const result = validateDocJSON(doc);
    expect(result.ok ? [] : result.errors).toEqual([]);
  });

  it('round-trips losslessly through Yjs', () => {
    const doc = kitchenSinkDoc();
    const ydoc = createDocFromJSON(doc);
    const read = readDocJSON(ydoc);
    expect(docJSONEqual(read, doc)).toBe(true);
    expect(read).toEqual(normalizeDocJSON(doc));
    const again = new Y.Doc();
    Y.applyUpdate(again, Y.encodeStateAsUpdate(ydoc));
    expect(readDocJSON(again)).toEqual(read);
    const { nodes, marks } = typesIn(read);
    expect(nodes.size).toBe(NODE_NAMES.length);
    expect(marks.size).toBe(MARK_NAMES.length);
  });

  it('keeps embed data objects and attributes exactly', () => {
    const read = readDocJSON(createDocFromJSON(kitchenSinkDoc()));
    const embeds = read.content.filter((block) => block.type === 'embed');
    expect(embeds.map((embed) => embed.attrs)).toEqual([
      {
        kind: 'database',
        ref: FIXTURE_IDS.database,
        data: { viewId: FIXTURE_IDS.view },
        blockId: null,
      },
      {
        kind: 'web',
        ref: 'https://www.youtube.com/watch?v=abc',
        data: { display: 'embed' },
        blockId: null,
      },
      {
        kind: 'file',
        ref: FIXTURE_IDS.fileAsset,
        data: { name: 'flight-plan.pdf', size: 1024, mimeType: 'application/pdf' },
        blockId: null,
      },
      {
        kind: 'plugin:mermaid/diagram',
        ref: null,
        data: { source: 'graph TD; A-->B' },
        blockId: null,
      },
    ]);
  });
});

describe('empty documents', () => {
  it('reads an empty fragment as one empty paragraph', () => {
    const read = readDocJSON(new Y.Doc());
    expect(read).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', attrs: { blockId: null, color: null } }],
    });
    expect(isDocEmpty(read)).toBe(true);
    expect(isDocEmpty(kitchenSinkDoc())).toBe(false);
    expect(docJSONEqual(emptyDocJSON(), read)).toBe(true);
  });

  it('writes and reads an empty document', () => {
    const ydoc = createDocFromJSON(emptyDocJSON());
    expect(readDocJSON(ydoc)).toEqual(normalizeDocJSON(emptyDocJSON()));
  });
});

describe('validateDocJSON', () => {
  const invalid: Array<[string, unknown]> = [
    ['a non-doc root', { type: 'paragraph' }],
    ['an unknown node', b.doc({ type: 'mystery' } as never)],
    [
      'an unknown mark',
      b.doc(b.paragraph({ type: 'text', text: 'x', marks: [{ type: 'superscript' }] } as never)),
    ],
    ['an unknown attribute', b.doc({ type: 'paragraph', attrs: { align: 'center' } } as never)],
    ['a heading level of 4', b.doc({ type: 'heading', attrs: { level: 4 } } as never)],
    ['an unknown block color', b.doc({ type: 'paragraph', attrs: { color: 'teal' } } as never)],
    [
      'an unknown callout tone',
      b.doc({ type: 'callout', attrs: { tone: 'loud' }, content: [b.paragraph()] } as never),
    ],
    ['a javascript: link', b.doc(b.paragraph(b.text('x', b.mark.link('javascript:alert(1)'))))],
    [
      'an obfuscated javascript: link',
      b.doc(b.paragraph(b.text('x', b.mark.link('java\tscript:alert(1)')))),
    ],
    [
      'a data: link',
      b.doc(b.paragraph(b.text('x', b.mark.link('data:text/html,<script>alert(1)</script>')))),
    ],
    ['an image without a source', b.doc(b.image({ alt: 'nothing' }))],
    ['a javascript: image', b.doc(b.image({ src: 'javascript:alert(1)' }))],
    ['an embed without kind', b.doc({ type: 'embed', attrs: { ref: 'x' } } as never)],
    ['an embed with an invalid kind', b.doc(b.embed('Not A Kind'))],
    ['a web embed without an http URL', b.doc(b.embed('web', 'ftp://example.com'))],
    ['a page link with an invalid ID', b.doc(b.paragraph(b.pageLink('not valid!')))],
    ['a tag with an invalid name', b.doc(b.paragraph(b.tag('1984')))],
    [
      'marks on an atom',
      b.doc(b.paragraph({ ...b.pageLink(FIXTURE_IDS.spec), marks: [{ type: 'bold' }] } as never)),
    ],
    [
      'duplicate block IDs',
      b.doc(
        { type: 'paragraph', attrs: { blockId: 'dup' } },
        { type: 'paragraph', attrs: { blockId: 'dup' } },
      ),
    ],
    ['a list item starting with a heading', b.doc(b.bulletList(b.listItem(b.heading(1, 'x'))))],
    ['an empty list', b.doc({ type: 'bulletList', content: [] } as never)],
    [
      'a paragraph inside a paragraph',
      b.doc({ type: 'paragraph', content: [b.paragraph('x')] } as never),
    ],
    ['text at the root', { type: 'doc', content: [b.text('x')] }],
    ['marks in a code block', b.doc({ type: 'codeBlock', content: [b.text('x', b.mark.bold())] })],
    ['empty text', b.doc(b.paragraph({ type: 'text', text: '' }))],
    ['a heading in a table cell', b.doc(b.table({}, [b.tableCell(b.heading(1, 'x') as never)]))],
    ['a toggle without summary', b.doc({ type: 'toggle', content: [b.paragraph('x')] } as never)],
  ];

  it.each(invalid)('rejects %s', (_label, json) => {
    const result = validateDocJSON(json);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThan(0);
  });

  it('accepts safe links and image sources', () => {
    for (const href of [
      'https://example.com',
      'http://x.io/a?b#c',
      'mailto:a@b.co',
      'tel:+15551234',
      '/relative',
      '#heading',
      'page.md',
    ]) {
      expect(isSafeHref(href)).toBe(true);
    }
    for (const src of ['https://example.com/a.png', 'assets/a.png', 'data:image/png;base64,AAAA']) {
      expect(isSafeImageSrc(src)).toBe(true);
    }
    expect(isSafeImageSrc('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isSafeHref('vbscript:x')).toBe(false);
    expect(isSafeHref(' JavaScript:alert(1)')).toBe(false);
  });

  it('refuses to write invalid documents and leaves the doc untouched', () => {
    const ydoc = createDocFromJSON(b.doc('Keep me'));
    const before = Y.encodeStateVector(ydoc);
    expect(() => writeDocJSON(ydoc, b.doc(b.image({ alt: 'no source' })))).toThrow(ValidationError);
    expect(Y.encodeStateVector(ydoc)).toEqual(before);
    expect(readDocJSON(ydoc).content[0]).toMatchObject({ content: [{ text: 'Keep me' }] });
  });
});

describe('normalizeDocJSON', () => {
  function textOf(doc: unknown): string {
    const parts: string[] = [];
    walkDocJSON(doc as never, (node) => {
      if (node.type === 'text') parts.push(node.text ?? '');
    });
    return parts.join('|');
  }

  it('repairs every invalid shape into a valid document without losing text', () => {
    const messy = {
      type: 'doc',
      content: [
        { type: 'mystery', content: [b.paragraph('unwrapped')] },
        b.text('loose text'),
        {
          type: 'heading',
          attrs: { level: 6, color: 'teal', align: 'x' },
          content: [b.text('big')],
        },
        { type: 'paragraph', content: [b.paragraph('nested'), b.text('after')] },
        b.bulletList(b.listItem(b.heading(2, 'heading item')), 'plain item'),
        {
          type: 'bulletList',
          content: [b.text('inline in list'), b.taskItem(true, 'converted task')],
        },
        { type: 'taskList', content: [] },
        { type: 'toggle', content: [b.paragraph('becomes summary'), b.paragraph('body')] },
        { type: 'toggle', content: [b.bulletList('no summary')] },
        b.table(
          {},
          [b.tableCell(b.heading(1, 'cell heading') as never), 'ok'],
          [b.text('row text') as never],
        ),
        {
          type: 'codeBlock',
          content: [b.text('bold code', b.mark.bold()), b.hardBreak(), b.tag('tagged')],
        },
        b.paragraph(
          b.text('bad link', b.mark.link('javascript:alert(1)')),
          b.text(' good', b.mark.bold(), b.mark.italic(), b.mark.bold()),
        ),
        b.paragraph(b.text('coded', b.mark.bold(), b.mark.code())),
        b.image({ alt: 'no source' }),
        b.image({ src: 'https://x.io/a.png', width: 250 }),
        b.paragraph(b.pageLink('bad id!', { label: 'kept label' }), ' ', b.tag('1984')),
        b.embed('Bad Kind'),
        { type: 'blockquote', content: [] },
        { type: 'paragraph', attrs: { blockId: 'same' } },
        { type: 'paragraph', attrs: { blockId: 'same' } },
        { type: 'doc', content: [b.paragraph('nested doc')] },
        'garbage',
        null,
      ],
    };
    const doc = normalizeDocJSON(messy);
    const result = validateDocJSON(doc);
    expect(result.ok ? [] : result.errors).toEqual([]);
    const text = textOf(doc);
    for (const piece of [
      'unwrapped',
      'loose text',
      'big',
      'nested',
      'after',
      'heading item',
      'plain item',
      'inline in list',
      'converted task',
      'becomes summary',
      'body',
      'no summary',
      'cell heading',
      'row text',
      'bad link',
      ' good',
      'coded',
      'kept label',
      '#1984',
      'nested doc',
    ]) {
      expect(text).toContain(piece);
    }
    expect(text).toContain('bold code\n#tagged');
    const heading = doc.content.find((block) => block.type === 'heading');
    expect(heading?.attrs).toEqual({ level: 3, blockId: null, color: null });
    const image = doc.content.find((block) => block.type === 'image');
    expect(image?.attrs).toMatchObject({ width: 100, src: 'https://x.io/a.png' });
    const ids: string[] = [];
    walkDocJSON(doc, (node) => {
      if (typeof node.attrs?.blockId === 'string') ids.push(node.attrs.blockId);
    });
    expect(ids).toEqual(['same']);
  });

  it('orders and deduplicates marks and merges adjacent text', () => {
    const doc = normalizeDocJSON(
      b.doc(
        b.paragraph(
          b.text('a', b.mark.italic(), b.mark.bold()),
          b.text('b', b.mark.bold(), b.mark.italic()),
          b.text('c'),
        ),
      ),
    );
    expect(doc.content[0]).toEqual({
      type: 'paragraph',
      attrs: { blockId: null, color: null },
      content: [
        { type: 'text', text: 'ab', marks: [{ type: 'bold' }, { type: 'italic' }] },
        { type: 'text', text: 'c' },
      ],
    });
  });

  it('returns an empty document for garbage', () => {
    for (const input of [null, 42, 'doc', { type: 'doc' }, { type: 'doc', content: 'x' }]) {
      expect(normalizeDocJSON(input)).toEqual(normalizeDocJSON(emptyDocJSON()));
    }
  });
});

describe('Yjs bridge', () => {
  it('writes minimal diffs so concurrent edits in other blocks survive', () => {
    const alice = createDocFromJSON(b.doc('one', 'two', 'three'));
    const bob = new Y.Doc();
    sync(alice, bob);
    writeDocJSON(alice, b.doc('one (Alice)', 'two', 'three'));
    writeDocJSON(bob, b.doc('one', 'two', 'three (Bob)'));
    sync(alice, bob);
    const expected = b.doc('one (Alice)', 'two', 'three (Bob)');
    expect(docJSONEqual(readDocJSON(alice), expected)).toBe(true);
    expect(docJSONEqual(readDocJSON(bob), expected)).toBe(true);
  });

  it('merges concurrent edits inside the same paragraph at character level', () => {
    const alice = createDocFromJSON(b.doc('The quick fox'));
    const bob = new Y.Doc();
    sync(alice, bob);
    writeDocJSON(alice, b.doc('The quick brown fox'));
    writeDocJSON(bob, b.doc('The quick fox jumps'));
    sync(alice, bob);
    expect(readDocJSON(alice)).toEqual(readDocJSON(bob));
    expect(nodeAtPath(readDocJSON(alice), [0, 0])?.text).toBe('The quick brown fox jumps');
  });

  it('updates through a transform and reports changes', () => {
    const ydoc = createDocFromJSON(b.doc('Hello'));
    let seen: unknown;
    expect(
      updateDocJSON(ydoc, (doc) => {
        seen = doc;
        return doc;
      }),
    ).toBe(false);
    expect(updateDocJSON(ydoc, () => null)).toBe(false);
    expect(seen).toEqual(readDocJSON(ydoc));
    expect(
      updateDocJSON(ydoc, (doc) => ({ ...doc, content: [...doc.content, b.paragraph('World')] })),
    ).toBe(true);
    expect(readDocJSON(ydoc).content).toHaveLength(2);
  });

  it('uses the transaction origin for writes', () => {
    const ydoc = new Y.Doc();
    const origins: unknown[] = [];
    ydoc.on('afterTransaction', (transaction: Y.Transaction) => origins.push(transaction.origin));
    writeDocJSON(ydoc, b.doc('x'), { origin: 'import' });
    expect(origins).toEqual(['import']);
  });

  it('reads content it cannot parse without modifying the doc', () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment('content');
    const unknown = new Y.XmlElement('mystery');
    const paragraphEl = new Y.XmlElement('paragraph');
    paragraphEl.insert(0, [new Y.XmlText('inside an unknown node')]);
    unknown.insert(0, [paragraphEl]);
    fragment.insert(0, [unknown]);
    const before = Y.encodeStateAsUpdate(ydoc);
    const read = readDocJSON(ydoc);
    expect(nodeAtPath(read, [0, 0])?.text).toBe('inside an unknown node');
    expect(Y.encodeStateAsUpdate(ydoc)).toEqual(before);
  });

  it('supports another fragment name', () => {
    const ydoc = new Y.Doc();
    writeDocJSON(ydoc, b.doc('snapshot'), { field: 'snapshot' });
    expect(readDocJSON(ydoc, { field: 'snapshot' }).content[0]).toMatchObject({
      content: [{ text: 'snapshot' }],
    });
    expect(isDocEmpty(readDocJSON(ydoc))).toBe(true);
  });
});
