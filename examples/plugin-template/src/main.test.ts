// @vitest-environment jsdom
import { createTestHarness } from '@tessera/plugin-api/testing';
import { describe, expect, it } from 'vitest';
import plugin from './main';

/**
 * The harness runs the plugin against an in-memory workspace, with the permissions you list, just
 * like Tessera: calls without permission reject.
 */
describe('My plugin', () => {
  it('says hello', async () => {
    const harness = createTestHarness(plugin, { permissions: ['ui:commands', 'ui:panels'] });
    await harness.activate();
    await harness.runCommand('say-hello');
    expect(harness.notifications).toEqual([{ title: 'Hello from My plugin 👋' }]);
  });

  it('shows the page you are on', async () => {
    const harness = createTestHarness(plugin, {
      permissions: ['pages:read', 'ui:panels'],
      pages: [
        { id: 'a', title: 'Apollo program' },
        { id: 'b', title: 'Gemini program' },
      ],
      currentPageId: 'a',
    });
    const panel = await harness.renderPanel('page');
    expect(panel.root.textContent).toContain('Apollo program');
    harness.setCurrentPage('b');
    await harness.flush();
    expect(panel.root.textContent).toContain('Gemini program');
  });
});
