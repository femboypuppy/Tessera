/**
 * Journey 9: two people write in the same page at the same time, in two browsers, through a real
 * Tessera server and the real editor. Each sees the other's words arrive live, where the other is
 * typing (their caret, labeled with their name), and who else is on the page.
 */
import { expect, test } from '../support';
import {
  connectAndUpload,
  createInviteLink,
  editor,
  joinWithInvite,
  writeInBody,
} from '../support/journeys';

const grace = { email: 'grace@example.com', name: 'Grace Hopper', password: 'compiler pioneer' };
const alan = { email: 'alan@example.com', name: 'Alan Turing', password: 'universal machine' };

test('two people type in one page at once and see each other live', async ({ collaborators }) => {
  const { server, alice: graceApp, bob: alanApp } = collaborators;
  test.setTimeout(180_000);
  await graceApp.createWorkspace('Compiler team');
  await graceApp.expectFeatures('sync', 'editor');

  await test.step('Grace shares a page with Alan', async () => {
    await server.createOwner(grace);
    await graceApp.newPage('Design review');
    await writeInBody(graceApp, ['Agenda']);
    await connectAndUpload(graceApp, server.url, grace);
    const invite = await createInviteLink(graceApp);
    await joinWithInvite(alanApp, server.url, invite, alan, 'Compiler team');
    await graceApp.openPage('Design review');
    await alanApp.openPage('Design review');
    await expect(editor(alanApp.page)).toContainText('Agenda');
  });

  await test.step('each sees who else is on the page', async () => {
    await expect(graceApp.page.getByTestId('presence')).toHaveAccessibleName(/Alan Turing/, {
      timeout: 15_000,
    });
    await expect(alanApp.page.getByTestId('presence')).toHaveAccessibleName(/Grace Hopper/, {
      timeout: 15_000,
    });
  });

  await test.step('both type at the same time, and every word arrives', async () => {
    await editor(graceApp.page).click();
    await graceApp.page.keyboard.press('ControlOrMeta+End');
    await graceApp.page.keyboard.press('Enter');
    await editor(alanApp.page).click();
    await alanApp.page.keyboard.press('ControlOrMeta+End');
    await alanApp.page.keyboard.press('Enter');
    await Promise.all([
      graceApp.page.keyboard.type('Grace: ship the linker first.', { delay: 20 }),
      alanApp.page.keyboard.type('Alan: prove the halting cases.', { delay: 20 }),
    ]);
    for (const app of [graceApp, alanApp]) {
      await expect(editor(app.page)).toContainText('Grace: ship the linker first.', {
        timeout: 15_000,
      });
      await expect(editor(app.page)).toContainText('Alan: prove the halting cases.', {
        timeout: 15_000,
      });
    }
  });

  await test.step('each sees the other’s caret, labeled with their name', async () => {
    await expect(
      graceApp.page.locator('.tess-remote-caret').filter({ hasText: 'Alan Turing' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      alanApp.page.locator('.tess-remote-caret').filter({ hasText: 'Grace Hopper' }),
    ).toBeVisible({ timeout: 15_000 });
  });

  await test.step('undo reverts only your own words', async () => {
    await editor(alanApp.page).focus();
    await alanApp.page.keyboard.press('ControlOrMeta+Z');
    await expect(editor(graceApp.page)).not.toContainText('Alan: prove the halting cases.', {
      timeout: 15_000,
    });
    await expect(editor(alanApp.page)).toContainText('Grace: ship the linker first.');
  });
});
