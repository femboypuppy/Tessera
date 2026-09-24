import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { earthrise } from './fixtures';
import {
  createPage,
  createWorkspace,
  docJSON,
  editor,
  findNodes,
  pageTree,
  setDoc,
  slash,
  type NodeJSON,
} from './helpers';

/** `pnpm screenshots e2e/editor` writes the editor screenshots used by the docs and README. */
const OUT = fileURLToPath(new URL('../../assets/screenshots/editor/', import.meta.url));

/**
 * Captures the view in the light and the dark theme. By default the pointer moves out of the way
 * first; `keepPointer` keeps it where it is (for hover states).
 */
async function snap(page: Page, name: string, { keepPointer = false } = {}): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  if (!keepPointer) await page.mouse.move(page.viewportSize()?.width ?? 0, 0);
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', colorScheme);
    await page.screenshot({
      path: `${OUT}${name}-${colorScheme}.png`,
      animations: 'disabled',
      caret: 'hide',
    });
  }
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
}

const text = (value: string, ...marks: string[]): NodeJSON => ({
  type: 'text',
  text: value,
  ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}),
});
const paragraph = (...content: NodeJSON[]): NodeJSON => ({ type: 'paragraph', content });
const heading = (level: number, value: string): NodeJSON => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)],
});
const cell = (type: 'tableCell' | 'tableHeader', value: string): NodeJSON => ({
  type,
  content: [paragraph(text(value))],
});
const row = (type: 'tableCell' | 'tableHeader', ...values: string[]): NodeJSON => ({
  type: 'tableRow',
  content: values.map((value) => cell(type, value)),
});

/** The flight plan page, with the page link and the uploaded image the UI created. */
function flightPlan(missionLink: NodeJSON, image: NodeJSON): NodeJSON {
  return {
    type: 'doc',
    content: [
      paragraph(
        text('Landing in the '),
        text('Sea of Tranquility', 'bold'),
        text('; every call goes through '),
        missionLink,
        text('.'),
      ),
      {
        type: 'callout',
        attrs: { emoji: '🚀', tone: 'info' },
        content: [
          paragraph(
            text('The launch window opens at '),
            text('13:32 UTC', 'code'),
            text('. Weather is go and winds are within limits.'),
          ),
        ],
      },
      heading(2, 'Launch day'),
      {
        type: 'taskList',
        content: [
          ['Suit up and check pressure', true],
          ['Board Columbia and seal the hatch', true],
          ['Align the guidance platform', false],
        ].map(([label, checked]) => ({
          type: 'taskItem',
          attrs: { checked },
          content: [paragraph(text(String(label)))],
        })),
      },
      {
        type: 'table',
        content: [
          row('tableHeader', 'Astronaut', 'Role', 'Spacecraft'),
          row('tableCell', 'Neil Armstrong', 'Commander', 'Eagle'),
          row('tableCell', 'Buzz Aldrin', 'Lunar module pilot', 'Eagle'),
          row('tableCell', 'Michael Collins', 'Command module pilot', 'Columbia'),
        ],
      },
      {
        type: 'codeBlock',
        attrs: { language: 'javascript' },
        content: [
          text(
            [
              '// Burn time for the descent engine',
              'const burnSeconds = (deltaV, thrust, mass) =>',
              '  (mass * deltaV) / thrust;',
            ].join('\n'),
          ),
        ],
      },
      {
        type: 'toggle',
        attrs: { open: true },
        content: [
          { type: 'toggleSummary', content: [text('Abort modes')] },
          paragraph(text('Mode I uses the escape tower; after it separates, the service engine.')),
        ],
      },
      image,
      paragraph(),
    ],
  };
}

test('editor screenshots', async ({ page }) => {
  await createWorkspace(page, 'Apollo research');
  await createPage(page, 'Mission control');
  await page.keyboard.type(
    'The flight control team in Houston runs the mission around the clock, in three shifts.',
  );
  await page.keyboard.press('Enter');
  await page.keyboard.type('Flight directors: Gene Kranz, Glynn Lunney and Cliff Charlesworth.');
  for (const title of ['Crew roster', 'Lunar module checklist', 'Reading list'])
    await createPage(page, title, { enter: false });

  await createPage(page, 'Apollo 11 flight plan');
  await page.keyboard.type('See [[Mission');
  await expect(page.getByRole('listbox', { name: 'Link to a page' })).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await slash(page, 'image');
  await page.getByLabel('Choose an image').setInputFiles({
    name: 'earthrise.png',
    mimeType: 'image/png',
    buffer: earthrise(),
  });
  await expect(editor(page).locator('.tess-image img')).toBeVisible();

  const created = await docJSON(page);
  const missionLink = findNodes(created, 'pageLink')[0];
  const uploaded = findNodes(created, 'image')[0];
  if (!missionLink || !uploaded) throw new Error('The link or the image is missing');
  const image: NodeJSON = {
    ...uploaded,
    attrs: { ...uploaded.attrs, width: 40, title: 'Earthrise, seen from lunar orbit' },
  };
  await setDoc(page, flightPlan(missionLink, image));
  await expect(editor(page).locator('.tess-image img')).toBeVisible();
  await expect(editor(page).locator('.hljs-keyword').first()).toBeVisible();
  await expect(
    pageTree(page).getByRole('treeitem', { name: 'Apollo 11 flight plan' }),
  ).toBeVisible();

  // The whole page, at rest, scrolled past the space above the title so every block fits.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await editor(page).evaluate((element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
        parent.scrollTop = 96;
        return;
      }
    }
  });
  await snap(page, 'rich-page');

  // Hovering a page link previews the page.
  const link = editor(page).locator('.tess-page-link', { hasText: 'Mission control' });
  await link.hover();
  await expect(page.getByRole('tooltip')).toContainText('three shifts');
  await snap(page, 'link-preview', { keepPointer: true });
  await page.mouse.move(1400, 20);
  await expect(page.getByRole('tooltip')).toBeHidden();

  // Selecting text shows the formatting toolbar.
  await editor(page).evaluate((element, phrase) => {
    const instance = (
      element as HTMLElement & {
        editor?: {
          state: {
            doc: {
              descendants(
                visit: (node: { isText: boolean; text?: string }, pos: number) => void,
              ): void;
            };
          };
          commands: {
            setTextSelection(range: { from: number; to: number }): boolean;
            focus(): boolean;
          };
        };
      }
    ).editor;
    let found: { from: number; to: number } | null = null;
    instance?.state.doc.descendants((node, pos) => {
      const index = node.isText && node.text ? node.text.indexOf(phrase) : -1;
      if (index >= 0 && !found) found = { from: pos + index, to: pos + index + phrase.length };
    });
    if (!found || !instance) throw new Error(`No "${phrase}"`);
    instance.commands.focus();
    instance.commands.setTextSelection(found);
  }, 'launch window opens');
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await expect(toolbar).toBeVisible();
  await snap(page, 'selection-toolbar');

  // The slash menu, on a new line under the introduction.
  await page.keyboard.press('ControlOrMeta+Home');
  await page.keyboard.press('End');
  await expect(toolbar).toBeHidden();
  await page.keyboard.press('Enter');
  await page.keyboard.type('/');
  const menu = page.getByRole('listbox', { name: 'Insert a block' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toBeVisible();
  await snap(page, 'slash-menu');
  await page.keyboard.press('Escape');
});
