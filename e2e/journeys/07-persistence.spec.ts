/**
 * Journey 7: nothing is lost. Pages, their order and their text survive a reload, and a second tab
 * sees changes made in the first.
 */
import { expect, test, TesseraApp } from '../support';
import { editor, writeInBody } from '../support/journeys';

test('work survives a reload and shows up in another tab', async ({
  freshWorkspace: app,
  page,
  context,
}) => {
  await app.requireFeatures('persistence', 'editor');

  await test.step('pages with text are written', async () => {
    await app.newPage('Flight plan');
    await writeInBody(app, ['Trans-lunar injection at 2:44:16.']);
    await app.newPage('Crew notes');
  });

  await test.step('a reload brings everything back', async () => {
    await page.reload();
    await expect(app.treeItem('Flight plan')).toBeVisible();
    await expect(app.treeItem('Crew notes')).toBeVisible();
    await app.openPage('Flight plan');
    await expect(editor(page)).toContainText('Trans-lunar injection at 2:44:16.');
  });

  await test.step('a second tab sees a new page right away', async () => {
    const second = new TesseraApp(await context.newPage());
    await second.page.goto('/');
    await expect(second.treeItem('Flight plan')).toBeVisible();
    await app.newPage('Written in the first tab');
    await expect(second.treeItem('Written in the first tab')).toBeVisible();
    await second.page.close();
  });
});
