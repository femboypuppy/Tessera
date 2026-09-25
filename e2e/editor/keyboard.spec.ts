import { expect, test, type Page } from '@playwright/test';
import {
  caret,
  createPage,
  createWorkspace,
  docJSON,
  editor,
  marksOn,
  outline,
  redo,
  undo,
} from './helpers';

/** The blocks shown as selected: one block (a node selection) or a range of blocks. */
function selectedBlocks(page: Page) {
  return editor(page).locator('.tess-block-selected, .ProseMirror-selectednode');
}

async function writeLines(page: Page, lines: string[]): Promise<void> {
  for (const [index, line] of lines.entries()) {
    if (index) await page.keyboard.press('Enter');
    await page.keyboard.type(line);
  }
}

test('selects, deletes, moves and duplicates blocks from the keyboard', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Launch sequence');
  await writeLines(page, ['Ignition', 'Liftoff', 'Staging', 'Orbit']);
  const start = ['paragraph:Ignition', 'paragraph:Liftoff', 'paragraph:Staging', 'paragraph:Orbit'];
  await expect.poll(() => outline(page)).toEqual(start);

  // Escape selects the block with the caret; arrows move the selection, Shift extends it.
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await caret(page)).text).toBe('Liftoff');
  await page.keyboard.press('Escape');
  await expect(selectedBlocks(page)).toHaveText(['Liftoff']);
  await page.keyboard.press('ArrowDown');
  await expect(selectedBlocks(page)).toHaveText(['Staging']);
  await page.keyboard.press('Shift+ArrowUp');
  await expect(selectedBlocks(page)).toHaveText(['Liftoff', 'Staging']);

  // Delete removes the selected blocks; undo brings them back.
  await page.keyboard.press('Delete');
  await expect.poll(() => outline(page)).toEqual(['paragraph:Ignition', 'paragraph:Orbit']);
  await undo(page);
  await expect.poll(() => outline(page)).toEqual(start);

  // Mod+Shift+↑/↓ move the block with the caret, which stays in it.
  await editor(page).getByText('Staging', { exact: true }).click();
  await expect.poll(async () => (await caret(page)).text).toBe('Staging');
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Ignition', 'paragraph:Staging', 'paragraph:Liftoff', 'paragraph:Orbit']);
  await page.keyboard.press('ControlOrMeta+Shift+ArrowUp');
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Staging', 'paragraph:Ignition', 'paragraph:Liftoff', 'paragraph:Orbit']);
  await page.keyboard.type(' two');
  await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
  await expect
    .poll(() => outline(page))
    .toEqual([
      'paragraph:Ignition',
      'paragraph:Staging two',
      'paragraph:Liftoff',
      'paragraph:Orbit',
    ]);

  // Mod+D duplicates it; undo and redo.
  await page.keyboard.press('ControlOrMeta+d');
  const duplicated = [
    'paragraph:Ignition',
    'paragraph:Staging two',
    'paragraph:Staging two',
    'paragraph:Liftoff',
    'paragraph:Orbit',
  ];
  await expect.poll(() => outline(page)).toEqual(duplicated);
  await undo(page);
  await expect.poll(async () => (await outline(page)).length).toBe(4);
  await redo(page);
  await expect.poll(() => outline(page)).toEqual(duplicated);
  // Copies get their own block IDs.
  const ids = (await docJSON(page)).content?.map((node) => node.attrs?.blockId);
  expect(new Set(ids).size).toBe(ids?.length);
});

test('reaches the formatting toolbar from the keyboard', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Radio log');
  await page.keyboard.type('Houston, Tranquility Base here.');
  for (let i = 0; i < 'here.'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft');
  const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
  await expect(toolbar).toBeVisible();

  // Alt+F10 moves focus into the toolbar; arrows move between its buttons.
  await page.keyboard.press('Alt+F10');
  await expect(toolbar.locator(':focus')).toHaveCount(1);
  const bold = toolbar.getByRole('button', { name: 'Bold' });
  for (
    let i = 0;
    i < 6 && !(await bold.evaluate((element) => element === document.activeElement));
    i += 1
  )
    await page.keyboard.press('ArrowRight');
  await expect(bold).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(async () => marksOn(await docJSON(page), 'here.')).toEqual(['bold']);
  await expect(bold).toHaveAttribute('aria-pressed', 'true');

  // Escape returns to the text, with the selection intact.
  await page.keyboard.press('Escape');
  await expect(editor(page)).toBeFocused();
  await page.keyboard.press('ControlOrMeta+i');
  await expect.poll(async () => marksOn(await docJSON(page), 'here.')).toEqual(['bold', 'italic']);
});

test('a key acts where the caret is, even before the browser reports the move', async ({
  page,
}) => {
  await createWorkspace(page);
  await createPage(page, 'Flight notes');
  await writeLines(page, ['Notes', 'Liftoff']);
  await expect.poll(() => outline(page)).toEqual(['paragraph:Notes', 'paragraph:Liftoff']);
  await page.keyboard.press('Home');
  await expect.poll(() => caret(page)).toEqual({ text: 'Liftoff', offset: 0 });
  // End then Enter on a busy main thread: the caret moves, and Enter is handled before the
  // browser's selectionchange event (always queued for later) tells the editor.
  await editor(page).evaluate((element) => {
    const text = [...element.querySelectorAll('p')].at(-1)?.firstChild;
    if (!text) throw new Error('No "Liftoff" text');
    element.ownerDocument.getSelection()?.collapse(text, text.textContent?.length ?? 0);
    element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
    );
  });
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Notes', 'paragraph:Liftoff', 'paragraph:']);
  await expect.poll(() => caret(page)).toEqual({ text: '', offset: 0 });
});

test.describe('at phone width', () => {
  test.use({ hasTouch: true });

  test('the block handle is a tap target and the toolbar fits', async ({ page }) => {
    await createWorkspace(page);
    await createPage(page, 'Field notes');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.keyboard.type('Pack the camera, the flag and the plaque.');
    await expect(editor(page)).toBeVisible();

    // Nothing overflows the screen sideways.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Selecting text shows the toolbar inside the screen.
    for (let i = 0; i < 'plaque.'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft');
    const toolbar = page.getByRole('toolbar', { name: 'Formatting' });
    await expect(toolbar).toBeVisible();
    const box = await toolbar.boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(390);

    // Tapping the text puts the handle next to it; tapping the handle opens the block menu.
    await editor(page).getByText('Pack the camera', { exact: false }).tap();
    const grip = page.getByRole('button', { name: 'Block actions' });
    await expect(grip).toBeVisible();
    const gripBox = await grip.boundingBox();
    expect(gripBox?.width).toBeGreaterThanOrEqual(24);
    await grip.tap();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Duplicate' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toBeHidden();
  });
});
