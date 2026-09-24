/**
 * Journey 6: exporting. Write two linked pages and export the workspace as a markdown zip: the
 * files carry the text and the link as a wikilink.
 */
import { expect, readZip, temporaryFolder, test } from '../support';
import { insertPageLink, runCommand, writeInBody } from '../support/journeys';

test('export the workspace to a markdown zip', async ({ freshWorkspace: app, page }) => {
  await app.requireFeatures('export', 'editor', 'search');

  await test.step('two linked pages exist', async () => {
    await app.newPage('Apollo program');
    await writeInBody(app, ['Twelve people walked on the Moon.']);
    await app.newPage('Saturn V');
    await writeInBody(app, ['It launched ']);
    await insertPageLink(app, 'Apollo', 'Apollo program');
  });

  const files = await test.step('the export dialog downloads a zip', async () => {
    await runCommand(app, 'Export');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // By name from its start: the backup format's description also mentions "workspace".
    await dialog.getByRole('radio', { name: /^Markdown/ }).click();
    await dialog.getByRole('radio', { name: /^The whole workspace/ }).click();
    const download = page.waitForEvent('download');
    await dialog
      .getByRole('button', { name: /^export/i })
      .last()
      .click();
    const file = `${temporaryFolder()}/export.zip`;
    await (await download).saveAs(file);
    return readZip(file);
  });

  await test.step('the zip holds the pages as markdown with wikilinks', async () => {
    const names = [...files.keys()];
    const apollo = names.find((name) => name.endsWith('Apollo program.md'));
    const saturn = names.find((name) => name.endsWith('Saturn V.md'));
    expect(apollo, names.join(', ')).toBeDefined();
    expect(files.get(apollo ?? '')).toContain('Twelve people walked on the Moon.');
    expect(files.get(saturn ?? '')).toContain('[[Apollo program]]');
  });
});
