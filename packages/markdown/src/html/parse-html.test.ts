import { validateDocJSON, type AnyNodeJSON } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { createMarkdownCodec } from '../codec';
import { tokenizeHtml } from './tokenize';
import { parseHtmlToDoc } from './parse-html';

const codec = createMarkdownCodec();

function parseHTML(html: string): AnyNodeJSON[] {
  const doc = codec.parseHTML(html);
  expect(validateDocJSON(doc).ok).toBe(true);
  return doc.content as AnyNodeJSON[];
}

describe('parseHTML', () => {
  it('sanitizes: no scripts, handlers or unsafe URLs survive', () => {
    const html =
      '<p onclick="steal()">Hi <a href="javascript:alert(1)">link</a><script>alert(2)</script></p>' +
      '<img src="x" onerror="alert(3)"><iframe src="https://evil.example"></iframe><style>p{}</style>';
    const content = parseHTML(html);
    const json = JSON.stringify(content);
    expect(json).not.toMatch(/alert|steal|javascript|onerror|evil|p\{\}/);
    expect(content).toEqual([
      {
        type: 'paragraph',
        attrs: { blockId: null, color: null },
        content: [{ type: 'text', text: 'Hi link' }],
      },
    ]);
  });

  it('reads Google Docs clipboard HTML (the bold wrapper is not bold)', () => {
    const html =
      '<meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-1234">' +
      '<h1 dir="ltr"><span style="font-size:20pt;font-weight:400;">Mission brief</span></h1>' +
      '<p dir="ltr"><span style="font-weight:700;">Crew</span><span style="font-weight:400;"> and </span>' +
      '<span style="font-style:italic;">vehicle</span><span style="text-decoration:underline;">notes</span></p>' +
      '<ul><li dir="ltr" style="list-style-type:disc;"><p dir="ltr"><span>Armstrong</span></p></li>' +
      '<li dir="ltr" role="checkbox" aria-checked="true"><p dir="ltr"><span>Checked</span></p></li></ul></b>';
    const content = parseHTML(html);
    expect(content[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Mission brief' }],
    });
    expect(content[0]?.content?.[0]?.marks).toBeUndefined();
    expect(content[1]?.content).toEqual([
      { type: 'text', text: 'Crew', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' and ' },
      { type: 'text', text: 'vehicle', marks: [{ type: 'italic' }] },
      { type: 'text', text: 'notes', marks: [{ type: 'underline' }] },
    ]);
    expect(content[2]).toMatchObject({ type: 'bulletList', content: [{ type: 'listItem' }] });
    expect(content[3]).toMatchObject({
      type: 'taskList',
      content: [{ type: 'taskItem', attrs: { checked: true } }],
    });
  });

  it('reads Word lists written as paragraphs', () => {
    const html =
      '<p class=MsoNormal>Steps:</p>' +
      '<p class=MsoListParagraphCxSpFirst style="text-indent:-.25in;mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">1.<span>&nbsp;&nbsp;</span></span>Fuel</p>' +
      '<p class=MsoListParagraphCxSpMiddle style="margin-left:1.0in;mso-list:l0 level2 lfo1"><span style="mso-list:Ignore">a.<span>&nbsp;</span></span>Check valves</p>' +
      '<p class=MsoListParagraphCxSpLast style="text-indent:-.25in;mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">2.<span>&nbsp;</span></span>Launch<o:p></o:p></p>';
    const content = parseHTML(html);
    expect(content[0]).toMatchObject({ type: 'paragraph', content: [{ text: 'Steps:' }] });
    expect(content[1]).toMatchObject({
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ text: 'Fuel' }] }, { type: 'orderedList' }],
        },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ text: 'Launch' }] }] },
      ],
    });
    expect(content[1]?.content?.[0]?.content?.[1]?.content?.[0]).toMatchObject({
      content: [{ type: 'paragraph', content: [{ text: 'Check valves' }] }],
    });
  });

  it('reads Notion HTML: colors, to-dos, toggles and callouts', () => {
    const html =
      '<h2 class="block-color-blue">Plan</h2>' +
      '<p>Text with <mark class="highlight-red">red</mark> marks</p>' +
      '<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Book hall</span></li>' +
      '<li><div class="checkbox checkbox-off"></div> <span>Send invites</span></li></ul>' +
      '<details open=""><summary>More</summary><p>Hidden</p></details>' +
      '<figure class="callout"><div style="font-size:1.5em"><span class="icon">⚠️</span></div><div style="width:100%">Careful</div></figure>';
    const content = parseHTML(html);
    expect(content[0]).toMatchObject({ type: 'heading', attrs: { level: 2, color: 'blue' } });
    expect(content[1]?.content?.[1]).toEqual({
      type: 'text',
      text: 'red',
      marks: [{ type: 'highlight', attrs: { color: 'red' } }],
    });
    expect(content[2]).toMatchObject({
      type: 'taskList',
      content: [
        {
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ text: 'Book hall' }] }],
        },
        {
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ text: 'Send invites' }] }],
        },
      ],
    });
    expect(content[3]).toMatchObject({
      type: 'toggle',
      attrs: { open: true },
      content: [
        { type: 'toggleSummary', content: [{ text: 'More' }] },
        { type: 'paragraph', content: [{ text: 'Hidden' }] },
      ],
    });
    expect(content[4]).toMatchObject({
      type: 'callout',
      attrs: { emoji: '⚠️', tone: 'warning' },
      content: [{ content: [{ text: 'Careful' }] }],
    });
  });

  it('reads ordinary web pages: headings, links, code, tables, images, task lists', () => {
    const html =
      '<article><h4>Deep heading</h4><p>Read <a href="https://example.com/doc" title="Docs">the docs</a>.<br>Then go.</p>' +
      '<pre><code class="language-js">const x = 1;\nconsole.log(x);</code></pre>' +
      '<table><thead><tr><th>Name</th><th>Role</th></tr></thead><tbody><tr><td>Ada</td><td><b>Pilot</b></td></tr></tbody></table>' +
      '<img src="https://example.com/moon.png" alt="Moon">' +
      '<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked disabled> Done</li></ul>' +
      '<blockquote><p>Quote</p></blockquote><hr><ol start="3"><li>Third</li></ol></article>';
    const content = parseHTML(html);
    expect(content.map((block) => block.type)).toEqual([
      'heading',
      'paragraph',
      'codeBlock',
      'table',
      'image',
      'taskList',
      'blockquote',
      'horizontalRule',
      'orderedList',
    ]);
    expect(content[0]?.attrs?.level).toBe(3);
    expect(content[1]?.content).toEqual([
      { type: 'text', text: 'Read ' },
      {
        type: 'text',
        text: 'the docs',
        marks: [{ type: 'link', attrs: { href: 'https://example.com/doc', title: 'Docs' } }],
      },
      { type: 'text', text: '.' },
      { type: 'hardBreak' },
      { type: 'text', text: 'Then go.' },
    ]);
    expect(content[2]).toMatchObject({
      attrs: { language: 'js' },
      content: [{ text: 'const x = 1;\nconsole.log(x);' }],
    });
    expect(content[3]?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
    expect(content[3]?.content?.[1]?.content?.[1]?.content?.[0]?.content?.[0]?.marks).toEqual([
      { type: 'bold' },
    ]);
    expect(content[4]).toMatchObject({
      attrs: { src: 'https://example.com/moon.png', alt: 'Moon' },
    });
    expect(content[5]).toMatchObject({
      content: [{ attrs: { checked: true }, content: [{ content: [{ text: 'Done' }] }] }],
    });
    expect(content[8]?.attrs?.start).toBe(3);
  });

  it('turns plain text and empty input into valid documents', () => {
    expect(parseHTML('just text')).toMatchObject([
      { type: 'paragraph', content: [{ text: 'just text' }] },
    ]);
    expect(parseHTML('')).toMatchObject([{ type: 'paragraph' }]);
  });

  it('round trips its own output through markdown', () => {
    const doc = codec.parseHTML(
      '<h2>Title</h2><p><strong>Bold</strong> <em>and</em> <code>code</code></p><ul><li>One</li></ul>',
    );
    expect(codec.parse(codec.serialize(doc)).doc).toEqual(doc);
  });
});

describe('HTML without a DOM (workers)', () => {
  it('tokenizes forgivingly and drops script content', () => {
    expect(tokenizeHtml('<p class="a">Hi &amp; <b>bye</b><script>x()</script></p> 1 < 2')).toEqual([
      { type: 'open', name: 'p', attrs: { class: 'a' }, selfClosing: false },
      { type: 'text', value: 'Hi & ' },
      { type: 'open', name: 'b', attrs: {}, selfClosing: false },
      { type: 'text', value: 'bye' },
      { type: 'close', name: 'b' },
      { type: 'close', name: 'p' },
      { type: 'text', value: ' 1 < 2' },
    ]);
  });

  it('keeps headings, paragraphs and marks through the whitelist', () => {
    const originalWindow = globalThis.window;
    // Simulate a worker: no DOM.
    Reflect.deleteProperty(globalThis, 'window');
    try {
      const doc = parseHtmlToDoc(
        '<h1>Title</h1><p>Some <b>bold</b><img src="https://x.test/a.png" onerror="x"></p><script>evil()</script>',
      );
      expect(doc.content).toMatchObject([
        { type: 'heading', attrs: { level: 1 }, content: [{ text: 'Title' }] },
        {
          type: 'paragraph',
          content: [{ text: 'Some ' }, { text: 'bold', marks: [{ type: 'bold' }] }],
        },
        { type: 'image', attrs: { src: 'https://x.test/a.png' } },
      ]);
      expect(JSON.stringify(doc)).not.toMatch(/evil|onerror/);
    } finally {
      globalThis.window = originalWindow;
    }
  });
});
