/**
 * Journey 2: writing and linking. Markdown shortcuts in the editor, a `[[link]]` to another page,
 * following it, and seeing the backlink on the other side.
 */
import { expect, test } from '../support';
import { editor, insertPageLink, openSidePanel, writeInBody } from '../support/journeys';

test('write a page, link it to another and find the backlink', async ({
  freshWorkspace: app,
  page,
}) => {
  await app.requireFeatures('editor', 'backlinks');

  await test.step('two pages exist', async () => {
    await app.newPage('Apollo program');
    await app.newPage('Saturn V');
  });

  await test.step('markdown shortcuts format the body as you type', async () => {
    await writeInBody(app, [
      '## Launch vehicle',
      'The first stage burned for 168 seconds.',
      '[] Review the engine telemetry',
    ]);
    await expect(
      editor(page).getByRole('heading', { level: 2, name: 'Launch vehicle' }),
    ).toBeVisible();
    await expect(editor(page).getByRole('checkbox')).toHaveCount(1);
  });

  await test.step('[[ links to another page', async () => {
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await page.keyboard.type('It carried the ');
    await insertPageLink(app, 'Apollo', 'Apollo program');
    await page.keyboard.type(' missions to the Moon.');
  });

  await test.step('the link opens the other page', async () => {
    await editor(page).getByText('Apollo program', { exact: true }).first().click();
    await expect(app.titleField()).toHaveValue('Apollo program');
  });

  await test.step('the other page lists the backlink with its context', async () => {
    const panel = await openSidePanel(app, /backlinks/i);
    await expect(panel).toContainText('Saturn V');
    await expect(panel).toContainText('missions to the Moon');
  });

  await test.step('renaming the target updates the link text', async () => {
    await app.titleField().fill('Apollo program (1961–1972)');
    await app.openPage('Saturn V');
    await expect(editor(page).getByText('Apollo program (1961–1972)')).toBeVisible();
  });
});
