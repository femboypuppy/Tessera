import { expect, test, type Locator, type Page } from '@playwright/test';
import { createPage, createWorkspace, editor, outline, redo, slash, undo } from './helpers';

/** The block element whose text is exactly `text`. */
function block(page: Page, text: string): Locator {
  return editor(page)
    .locator('p, li, [data-type="toggle-summary"], h1, h2, h3')
    .filter({ hasText: new RegExp(`^${text}$`) })
    .first();
}

/** Hovers a block so its handle appears next to it, and returns the handle's grip. */
async function gripOf(page: Page, text: string): Promise<Locator> {
  const box = await block(page, text).boundingBox();
  if (!box) throw new Error(`No block "${text}"`);
  await page.mouse.move(box.x + 12, box.y + box.height / 2);
  const grip = page.getByRole('button', { name: 'Block actions' });
  await expect(grip).toBeVisible();
  // The handle follows the pointer on the next frame: wait until it sits on this block's line.
  await expect
    .poll(async () => {
      const gripBox = await grip.boundingBox();
      return gripBox ? Math.abs(gripBox.y + gripBox.height / 2 - (box.y + box.height / 2)) : 999;
    })
    .toBeLessThan(box.height / 2);
  return grip;
}

/** Presses the grip and moves the pointer in steps to (x, y), then releases. */
async function dragTo(page: Page, grip: Locator, x: number, y: number): Promise<void> {
  const box = await grip.boundingBox();
  if (!box) throw new Error('No grip');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + 8, { steps: 3 });
  await page.mouse.move(x, y, { steps: 12 });
  await expect(page.locator('.tess-drop-indicator')).toBeVisible();
  await page.mouse.up();
}

test('drags blocks to a new position and into a toggle', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Drag and drop');
  for (const line of ['First', 'Second', 'Third']) {
    await page.keyboard.type(line);
    await page.keyboard.press('Enter');
  }
  await slash(page, 'toggle');
  await page.keyboard.type('Details');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Inside');
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:First', 'paragraph:Second', 'paragraph:Third', 'toggle:DetailsInside']);

  // Third moves above First: drop on the top half of First.
  const first = await block(page, 'First').boundingBox();
  if (!first) throw new Error('No first block');
  await dragTo(page, await gripOf(page, 'Third'), first.x + 40, first.y + 3);
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Third', 'paragraph:First', 'paragraph:Second', 'toggle:DetailsInside']);

  // Second moves into the toggle: drop on the lower half of the toggle's first line.
  const summary = await block(page, 'Details').boundingBox();
  if (!summary) throw new Error('No toggle');
  await dragTo(
    page,
    await gripOf(page, 'Second'),
    summary.x + 120,
    summary.y + summary.height * 0.8,
  );
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Third', 'paragraph:First', 'toggle:DetailsSecondInside']);

  // And back out, below the toggle.
  const inside = await block(page, 'Inside').boundingBox();
  if (!inside) throw new Error('No inside block');
  await dragTo(page, await gripOf(page, 'Second'), inside.x - 20, inside.y + inside.height + 40);
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Third', 'paragraph:First', 'toggle:DetailsInside', 'paragraph:Second']);

  // Each drop is one undo step; redo replays it.
  await editor(page).focus();
  await undo(page);
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Third', 'paragraph:First', 'toggle:DetailsSecondInside']);
  await undo(page);
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Third', 'paragraph:First', 'paragraph:Second', 'toggle:DetailsInside']);
  await redo(page);
  await expect
    .poll(() => outline(page))
    .toEqual(['paragraph:Third', 'paragraph:First', 'toggle:DetailsSecondInside']);
});

test('drags list items between lists and out of them', async ({ page }) => {
  await createWorkspace(page);
  await createPage(page, 'Lists');
  await page.keyboard.type('- Apples');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Pears');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Plain');
  await expect.poll(() => outline(page)).toEqual(['bulletList:ApplesPears', 'paragraph:Plain']);

  // A list item dropped below the paragraph stays a list item.
  const plain = await block(page, 'Plain').boundingBox();
  if (!plain) throw new Error('No paragraph');
  await dragTo(page, await gripOf(page, 'Apples'), plain.x + 40, plain.y + plain.height - 3);
  await expect
    .poll(() => outline(page))
    .toEqual(['bulletList:Pears', 'paragraph:Plain', 'bulletList:Apples']);

  // A paragraph dropped between list items becomes one; the lists it separated merge.
  const pears = await block(page, 'Pears').boundingBox();
  if (!pears) throw new Error('No list item');
  await dragTo(page, await gripOf(page, 'Plain'), pears.x + 40, pears.y + 3);
  await expect.poll(() => outline(page)).toEqual(['bulletList:PlainPearsApples']);
});

test('opens the block menu with a click on the handle, and Escape cancels a drag', async ({
  page,
}) => {
  await createWorkspace(page);
  await createPage(page, 'Handle');
  await page.keyboard.type('Only block');
  const grip = await gripOf(page, 'Only block');
  await grip.click();
  const menu = page.getByRole('menu', { name: 'Block actions' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Turn into' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  const box = await (await gripOf(page, 'Only block')).boundingBox();
  if (!box) throw new Error('No grip');
  await page.mouse.move(box.x + 5, box.y + 5);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 80, { steps: 6 });
  await expect(page.locator('.tess-drag-ghost')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.tess-drag-ghost')).toHaveCount(0);
  await page.mouse.up();
  await expect.poll(() => outline(page)).toEqual(['paragraph:Only block']);
});
