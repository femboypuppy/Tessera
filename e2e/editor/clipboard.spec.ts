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

/**
 * Puts the caret on a new empty paragraph at the end of the page, outside any list or quote (a
 * paste that ends in a list leaves the caret there; Enter on its empty item lifts it out), so the
 * next paste starts with its own blocks.
 */
async function newLineAtEnd(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+End');
  await page.keyboard.press('Enter');
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const last = (await docJSON(page)).content?.at(-1);
    if (last?.type === 'paragraph' && !last.content?.length) return;
    await page.keyboard.press('Enter');
  }
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
  // The real codec (remark), never core's stub: lists, quotes, code and marks keep their structure.
  expect((await readDiagnostics(page))?.services.markdownCodec).toBe('remark');
  expect(types(doc)).toEqual(
    expect.arrayContaining(['bulletList', 'orderedList', 'taskList', 'blockquote', 'codeBlock']),
  );
  expect(marksOn(doc, 'crew')).toEqual(['bold']);
  expect(marksOn(doc, 'dawn')).toEqual(['italic']);

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
    await newLineAtEnd(page);
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
  expect(findNodes(doc, 'listItem').length).toBeGreaterThanOrEqual(4);
  expect(marksOn(doc, 'Neil Armstrong')).toContain('bold');
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
  // The plain flavor is markdown, not the HTML flavor (markdown writes toggles as <details>), and
  // leaves out block IDs, which mean nothing to other apps.
  expect(clipboard['text/plain']).not.toMatch(/<(p|h[1-6]|ul|ol|li|div|span|strong|em)\b/i);
  expect(clipboard['text/plain']).not.toContain('data-pm-slice');
  expect(clipboard['text/plain']).not.toMatch(/ \^[A-Za-z0-9-]+$/m);
  expect(clipboard['text/plain']).toContain('## Checklist');

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
