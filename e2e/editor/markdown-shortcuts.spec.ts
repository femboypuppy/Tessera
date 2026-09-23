import { expect, test } from '@playwright/test';
import {
  createPage,
  createWorkspace,
  docJSON,
  editor,
  findNodes,
  marksOn,
  outline,
  redo,
  undo,
} from './helpers';

test('writes a whole document with markdown shortcuts only', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Launch plan');
  const type = (text: string) => page.keyboard.type(text);
  const enter = () => page.keyboard.press('Enter');

  await type('# Mission overview');
  await enter();
  await type(
    'We fly with **bold** plans, *careful* checks, `code` names, ~~doubts~~ and ==highlights== to share.',
  );
  await enter();
  await type('## Crew');
  await enter();
  await type('- Neil');
  await enter();
  await type('Buzz');
  await enter();
  await enter();
  await type('1. Launch');
  await enter();
  await type('Land');
  await enter();
  await enter();
  await type('[] Pack snacks');
  await enter();
  await type('Check the fuel');
  await enter();
  await enter();
  await type('[x] Book the rocket');
  await enter();
  await enter();
  await type('> One small step');
  await enter();
  await enter();
  await type('### Notes');
  await enter();
  await type('```js ');
  await type('const orbit = "moon";');
  await page.keyboard.press('ArrowDown');
  await type('---');
  await type('Filed under #apollo today');

  await expect
    .poll(() => outline(page))
    .toEqual([
      'heading:Mission overview',
      'paragraph:We fly with bold plans, careful checks, code names, doubts and highlights to share.',
      'heading:Crew',
      'bulletList:NeilBuzz',
      'orderedList:LaunchLand',
      'taskList:Pack snacksCheck the fuel',
      'taskList:Book the rocket',
      'blockquote:One small step',
      'heading:Notes',
      'codeBlock:const orbit = "moon";',
      'horizontalRule:',
      'paragraph:Filed under #apollo today',
    ]);

  const doc = await docJSON(page);
  const headings = findNodes(doc, 'heading').map((node) => node.attrs?.level);
  expect(headings).toEqual([1, 2, 3]);
  expect(marksOn(doc, 'bold')).toEqual(['bold']);
  expect(marksOn(doc, 'careful')).toEqual(['italic']);
  expect(marksOn(doc, 'code')).toEqual(['code']);
  expect(marksOn(doc, 'doubts')).toEqual(['strike']);
  expect(marksOn(doc, 'highlights')).toEqual(['highlight']);
  expect(findNodes(doc, 'taskItem').map((node) => node.attrs?.checked)).toEqual([
    false,
    false,
    true,
  ]);
  expect(findNodes(doc, 'codeBlock')[0]?.attrs?.language).toBe('js');
  expect(findNodes(doc, 'tag')[0]?.attrs?.name).toBe('apollo');

  // The rendered page shows the structure too.
  await expect(editor(page).locator('h1')).toHaveText('Mission overview');
  await expect(editor(page).locator('ul[data-type="taskList"] input[type="checkbox"]')).toHaveCount(
    3,
  );
  await expect(editor(page).locator('.tess-tag')).toHaveText('#apollo');

  // Undo walks back through the edits (grouped by typing pauses), redo replays them exactly.
  const final = await outline(page);
  await undo(page, 4);
  await expect.poll(async () => (await outline(page)).join('|')).not.toBe(final.join('|'));
  expect((await outline(page)).join('').length).toBeLessThan(final.join('').length);
  await redo(page, 4);
  await expect.poll(() => outline(page)).toEqual(final);
});

test('Backspace at the start of a heading or list item turns it back into text', async ({
  page,
}) => {
  await createWorkspace(page);
  await createPage(page, 'Undo shortcuts');
  await page.keyboard.type('# Title');
  await expect.poll(() => outline(page)).toEqual(['heading:Title']);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page)).toEqual(['paragraph:Title']);
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('- item');
  await expect.poll(() => outline(page)).toEqual(['paragraph:Title', 'bulletList:item']);
  await page.keyboard.press('Home');
  await page.keyboard.press('Backspace');
  await expect.poll(() => outline(page)).toEqual(['paragraph:Title', 'paragraph:item']);
});
