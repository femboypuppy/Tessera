import { expect, test, type Page } from '@playwright/test';
import {
  GOOGLE_DOCS_HTML,
  GOOGLE_DOCS_TEXT,
  MARKDOWN_FIXTURE,
  NOTION_HTML,
  NOTION_TEXT,
  WEB_PAGE_HTML,
  WEB_PAGE_TEXT,
} from './fixtures';
import {
  copyData,
  createPage,
  createWorkspace,
  docJSON,
  editor,
  findNodes,
  marksOn,
  outline,
  pasteData,
  readDiagnostics,
  redo,
  setDoc,
  undo,
  type NodeJSON,
} from './helpers';

/** True when the workspace runs the stub codec (paragraphs and headings only). */
async function stubCodec(page: Page): Promise<boolean> {
  const diagnostics = await readDiagnostics(page);
  return (diagnostics?.services.markdownCodec ?? 'basic') === 'basic';
}

function types(doc: NodeJSON): string[] {
  return (doc.content ?? []).map((node) => node.type);
}

test('pastes markdown as blocks', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Pasted markdown');
  await pasteData(page, { 'text/plain': MARKDOWN_FIXTURE });
  await expect.poll(async () => (await outline(page)).length).toBeGreaterThan(3);
  const doc = await docJSON(page);
  const headings = findNodes(doc, 'heading');
  expect(headings.map((node) => [node.attrs?.level, node.content?.[0]?.text])).toEqual([
    [1, 'Launch checklist'],
    [2, 'Before liftoff'],
  ]);
  const text = JSON.stringify(doc);
  for (const words of [
    'Fuel the rocket',
    'Check the weather',
    'Board',
    'Hatch closed',
    'countdown(10);',
  ])
    expect(text).toContain(words);
  if (await stubCodec(page)) {
    // The stub codec keeps everything else as paragraphs of plain text.
    expect(types(doc).every((type) => type === 'heading' || type === 'paragraph')).toBe(true);
  } else {
    expect(types(doc)).toEqual(
      expect.arrayContaining(['bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock']),
    );
    expect(marksOn(doc, 'crew')).toEqual(['bold']);
    expect(marksOn(doc, 'dawn')).toEqual(['italic']);
  }

  // One undo removes the whole paste; redo brings it back.
  const pasted = await outline(page);
  await undo(page);
  await expect.poll(() => outline(page)).toEqual(['paragraph:']);
  await redo(page);
  await expect.poll(() => outline(page)).toEqual(pasted);
});

test('pastes HTML from Google Docs, Notion and web pages as blocks, never raw HTML', async ({
  page,
}) => {
  await createWorkspace(page);
  await createPage(page, 'Pasted HTML');
  for (const [html, text] of [
    [GOOGLE_DOCS_HTML, GOOGLE_DOCS_TEXT],
    [NOTION_HTML, NOTION_TEXT],
    [WEB_PAGE_HTML, WEB_PAGE_TEXT],
  ] as const) {
    await pasteData(page, { 'text/html': html, 'text/plain': text });
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.press('Enter');
  }
  const doc = await docJSON(page);
  const serialized = JSON.stringify(doc);
  for (const words of [
    'Flight notes',
    'Orbit',
    'Stage one',
    'Mission roles',
    'Neil Armstrong',
    'Buzz Aldrin',
    'Tranquility Base',
    'Apollo 11',
    'first crewed landing',
    'July 16, 1969',
  ])
    expect(serialized).toContain(words);
  expect(serialized).not.toMatch(/<\/?(p|b|span|h\d|ul|li|script|iframe|img)\b/i);
  // Nothing is lost or doubled (a codec that drops text falls back to the plain-text flavor).
  expect(serialized.match(/Stage one/g)).toHaveLength(1);
  expect(serialized).not.toContain('onerror');
  expect(await page.evaluate(() => (window as { __pwned?: boolean }).__pwned)).toBeUndefined();
  const headings = findNodes(doc, 'heading').map((node) =>
    node.content?.map((child) => child.text).join(''),
  );
  expect(headings).toEqual(expect.arrayContaining(['Mission roles', 'Apollo 11']));
  if (!(await stubCodec(page))) {
    expect(findNodes(doc, 'listItem').length).toBeGreaterThanOrEqual(4);
    expect(marksOn(doc, 'Neil Armstrong')).toContain('bold');
  }
});

test('copies HTML and markdown, and pastes Tessera content back losslessly', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Source');
  const rich: NodeJSON = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Checklist' }] },
      {
        type: 'callout',
        attrs: { emoji: '⚠️', tone: 'warning' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Fuel is low' }] }],
      },
      {
        type: 'toggle',
        attrs: { open: true },
        content: [
          { type: 'toggleSummary', content: [{ type: 'text', text: 'Details' }] },
          { type: 'paragraph', content: [{ type: 'text', text: 'Hidden notes' }] },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: true },
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'Suits', marks: [{ type: 'bold' }] }],
              },
            ],
          },
        ],
      },
    ],
  };
  await setDoc(page, rich);
  await expect
    .poll(() => outline(page))
    .toEqual([
      'heading:Checklist',
      'callout:Fuel is low',
      'toggle:DetailsHidden notes',
      'taskList:Suits',
    ]);
  await editor(page).focus();
  await page.keyboard.press('ControlOrMeta+a');
  const clipboard = await copyData(page);
  expect(clipboard['text/html']).toContain('data-pm-slice');
  expect(clipboard['text/plain']).toContain('Checklist');
  expect(clipboard['text/plain']).not.toMatch(/<[a-z]/i);
  if (!(await stubCodec(page))) expect(clipboard['text/plain']).toContain('## Checklist');

  await createPage(page, 'Copy');
  await pasteData(page, clipboard);
  await expect
    .poll(() => outline(page))
    .toEqual([
      'heading:Checklist',
      'callout:Fuel is low',
      'toggle:DetailsHidden notes',
      'taskList:Suits',
    ]);
  const copy = await docJSON(page);
  expect(findNodes(copy, 'callout')[0]?.attrs).toMatchObject({ emoji: '⚠️', tone: 'warning' });
  expect(findNodes(copy, 'taskItem')[0]?.attrs?.checked).toBe(true);
  expect(marksOn(copy, 'Suits')).toEqual(['bold']);
  await undo(page);
  await expect.poll(() => outline(page)).toEqual(['paragraph:']);
});
