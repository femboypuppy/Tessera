/**
 * Journey 3: finding things. The command palette finds pages by title and by body text, opens
 * them, and searches tags.
 */
import { expect, test } from '../support';
import { openPalette, paletteInput, writeInBody } from '../support/journeys';

test('find pages by title, text and tag from the palette', async ({
  freshWorkspace: app,
  page,
}) => {
  await app.requireFeatures('search', 'editor');

  await test.step('pages with distinctive text exist', async () => {
    await app.newPage('Apollo 11 landing');
    // `#name` becomes a tag once a space follows it, as it does while typing.
    await writeInBody(app, ['The lunar module Eagle landed. Filed under #space for the archive.']);
    await app.newPage('Mission control');
    await writeInBody(app, ['Flight directors worked in three shifts.']);
  });

  await test.step('the palette finds a page by title', async () => {
    const palette = await openPalette(app);
    await paletteInput(palette).fill('mission contr');
    await expect(palette.getByRole('option', { name: /Mission control/ }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  await test.step('the palette finds a page by its text and opens it', async () => {
    const palette = await openPalette(app);
    await paletteInput(palette).fill('lunar module');
    const hit = palette.getByRole('option', { name: /Apollo 11 landing/ }).first();
    await expect(hit).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(app.titleField()).toHaveValue('Apollo 11 landing');
  });

  await test.step('tags are searchable', async () => {
    const palette = await openPalette(app);
    await paletteInput(palette).fill('#space');
    await expect(palette.getByRole('option', { name: /Apollo 11 landing/ }).first()).toBeVisible();
    await expect(palette.getByRole('option', { name: /Mission control/ })).toHaveCount(0);
  });
});
