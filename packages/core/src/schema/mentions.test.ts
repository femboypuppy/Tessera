import { describe, expect, it } from 'vitest';
import { InvalidOperationError } from '../errors';
import { build as b } from './builders';
import { validateDocJSON } from './docjson';
import { findTextOccurrences, replaceTextWithPageLink } from './mentions';
import { createDocFromJSON, readDocJSON, updateDocJSON } from './ydoc';

describe('findTextOccurrences', () => {
  const doc = b.doc(
    b.paragraph('Project Alpha is great. project alpha again, but not ProjectAlphaBeta or Alphas.'),
    b.heading(2, 'About Project ', b.text('Alpha', b.mark.bold())),
    b.paragraph(
      b.text('Project Alpha', b.mark.code()),
      ' ',
      b.text('Project Alpha', b.mark.link('https://x.io')),
    ),
    b.codeBlock('Project Alpha in code'),
    b.paragraph('Project', b.hardBreak(), 'Alpha across a break'),
    b.bulletList(b.listItem(b.paragraph('PA is short for Project Alpha'))),
  );

  it('finds whole-word, case-insensitive matches across marks but not across atoms', () => {
    const hits = findTextOccurrences(doc, 'Project Alpha');
    expect(hits.map((hit) => [hit.path, hit.from, hit.to, hit.text])).toEqual([
      [[0], 0, 13, 'Project Alpha'],
      [[0], 24, 37, 'project alpha'],
      [[1], 6, 19, 'Project Alpha'],
      [[5, 0, 0], 16, 29, 'Project Alpha'],
    ]);
    expect(hits[3]?.blockText).toBe('PA is short for Project Alpha');
  });

  it('supports several needles, case sensitivity, partial words, code and links', () => {
    const hits = findTextOccurrences(doc, ['Project Alpha', 'PA'], { caseSensitive: true });
    expect(hits.map((hit) => hit.text)).toEqual([
      'Project Alpha',
      'Project Alpha',
      'PA',
      'Project Alpha',
    ]);
    expect(findTextOccurrences(doc, 'alpha', { wholeWord: false }).length).toBeGreaterThan(4);
    expect(
      findTextOccurrences(doc, 'Project Alpha', { includeCode: true, includeLinked: true }),
    ).toHaveLength(6);
    expect(findTextOccurrences(doc, ['', '  '])).toEqual([]);
  });

  it('handles regex characters and unicode', () => {
    const special = b.doc(b.paragraph('Learn C++ (fast) or Über-Café today. über-café!'));
    expect(findTextOccurrences(special, 'C++').map((hit) => hit.text)).toEqual(['C++']);
    expect(findTextOccurrences(special, '(fast)').map((hit) => hit.text)).toEqual(['(fast)']);
    expect(findTextOccurrences(special, 'über-café').map((hit) => hit.text)).toEqual([
      'Über-Café',
      'über-café',
    ]);
  });
});

describe('replaceTextWithPageLink', () => {
  it('turns a mention into a page link and keeps surrounding marks', () => {
    const doc = b.doc(b.paragraph(b.text('See Project Alpha now', b.mark.italic())));
    const [hit] = findTextOccurrences(doc, 'project alpha');
    if (!hit) throw new Error('expected a hit');
    const linked = replaceTextWithPageLink(
      doc,
      hit,
      { pageId: 'alpha-page', label: hit.text },
      { expectedText: 'Project Alpha' },
    );
    expect(linked.content[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'See ', marks: [{ type: 'italic' }] },
        {
          type: 'pageLink',
          attrs: { pageId: 'alpha-page', label: 'Project Alpha', heading: null, blockRef: null },
        },
        { type: 'text', text: ' now', marks: [{ type: 'italic' }] },
      ],
    });
    expect(validateDocJSON(linked).ok).toBe(true);
    expect(doc.content[0]).toEqual(b.paragraph(b.text('See Project Alpha now', b.mark.italic())));
  });

  it('refuses stale or invalid ranges', () => {
    const doc = b.doc(b.paragraph('Alpha ', b.tag('x'), ' Beta'));
    expect(() =>
      replaceTextWithPageLink(
        doc,
        { path: [0], from: 0, to: 5 },
        { pageId: 'p' },
        { expectedText: 'Gamma' },
      ),
    ).toThrow(InvalidOperationError);
    expect(() =>
      replaceTextWithPageLink(doc, { path: [0], from: 4, to: 8 }, { pageId: 'p' }),
    ).toThrow(InvalidOperationError);
    expect(() =>
      replaceTextWithPageLink(doc, { path: [3], from: 0, to: 1 }, { pageId: 'p' }),
    ).toThrow(InvalidOperationError);
    expect(() =>
      replaceTextWithPageLink(doc, { path: [0], from: 2, to: 2 }, { pageId: 'p' }),
    ).toThrow(InvalidOperationError);
    expect(() =>
      replaceTextWithPageLink(doc, { path: [0], from: 10, to: 40 }, { pageId: 'p' }),
    ).toThrow(InvalidOperationError);
  });

  it('applies to a live Y.Doc through updateDocJSON', () => {
    const ydoc = createDocFromJSON(b.doc('Meeting with the Apollo team'));
    const [hit] = findTextOccurrences(readDocJSON(ydoc), 'Apollo team');
    if (!hit) throw new Error('expected a hit');
    const changed = updateDocJSON(ydoc, (current) =>
      replaceTextWithPageLink(current, hit, { pageId: 'apollo-team' }, { expectedText: hit.text }),
    );
    expect(changed).toBe(true);
    expect(readDocJSON(ydoc).content[0]).toMatchObject({
      content: [
        { type: 'text', text: 'Meeting with the ' },
        { type: 'pageLink', attrs: { pageId: 'apollo-team' } },
      ],
    });
  });
});
