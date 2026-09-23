/**
 * Journey 8: working together through a server, including going offline and back online. Alice
 * uploads her workspace to a real Tessera server and invites Bob; Bob joins; each sees the other's
 * edits; Alice keeps writing offline and her changes arrive when she reconnects.
 */
import { expect, test } from '../support';
import {
  connectAndUpload,
  createInviteLink,
  editor,
  joinWithInvite,
  syncStatus,
  writeInBody,
} from '../support/journeys';

const alice = { email: 'alice@example.com', name: 'Alice', password: 'correct horse battery' };
const bob = { email: 'bob@example.com', name: 'Bob', password: 'staple horse battery' };

test('two people edit one workspace, offline and back online', async ({ collaborators }) => {
  const { server, alice: aliceApp, bob: bobApp } = collaborators;
  await aliceApp.createWorkspace('Launch team');
  await aliceApp.requireFeatures('sync', 'editor');
  test.setTimeout(180_000);

  await test.step('Alice uploads her workspace to the server and invites Bob', async () => {
    await server.createOwner(alice);
    await aliceApp.newPage('Launch checklist');
    await writeInBody(aliceApp, ['Fuel the second stage.']);
    await connectAndUpload(aliceApp, server.url, alice);
  });

  const invite = await test.step('Alice creates an invite link', () => createInviteLink(aliceApp));

  await test.step('Bob joins with the invite and sees Alice’s page', async () => {
    await joinWithInvite(bobApp, server.url, invite, bob);
    await bobApp.openPage('Launch checklist');
    await expect(editor(bobApp.page)).toContainText('Fuel the second stage.');
  });

  await test.step('Bob’s edit reaches Alice live', async () => {
    await editor(bobApp.page).click();
    await bobApp.page.keyboard.press('ControlOrMeta+End');
    await bobApp.page.keyboard.press('Enter');
    await bobApp.page.keyboard.type('Check the weather at the Cape.');
    await aliceApp.openPage('Launch checklist');
    await expect(editor(aliceApp.page)).toContainText('Check the weather at the Cape.');
  });

  await test.step('Alice goes offline and keeps writing', async () => {
    await aliceApp.page.context().setOffline(true);
    await expect(syncStatus(aliceApp)).toHaveText(/offline/i, { timeout: 30_000 });
    await editor(aliceApp.page).click();
    await aliceApp.page.keyboard.press('ControlOrMeta+End');
    await aliceApp.page.keyboard.press('Enter');
    await aliceApp.page.keyboard.type('Written on the plane.');
    await expect(editor(bobApp.page)).not.toContainText('Written on the plane.');
  });

  await test.step('back online, Alice’s offline edits reach Bob', async () => {
    await aliceApp.page.context().setOffline(false);
    await expect(syncStatus(aliceApp)).toHaveText(/synced/i, { timeout: 30_000 });
    await expect(editor(bobApp.page)).toContainText('Written on the plane.', { timeout: 30_000 });
    await expect(editor(aliceApp.page)).toContainText('Check the weather at the Cape.');
  });
});
