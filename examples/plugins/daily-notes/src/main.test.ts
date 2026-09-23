import { createTestHarness } from '@tessera/plugin-api/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, formatDate, ordinal } from './dates';
import plugin from './main';

const permissions = ['pages:read', 'pages:write', 'ui:commands'] as const;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 24, 9, 30)); // Thursday, September 24, 2026
});

afterEach(() => {
  vi.useRealTimers();
});

describe('formatDate', () => {
  const date = new Date(2026, 8, 3);
  it.each([
    ['YYYY-MM-DD', '2026-09-03'],
    ['DD/MM/YY', '03/09/26'],
    ['MMMM D, YYYY', 'September 3, 2026'],
    ['dddd, MMM Do', 'Thursday, Sep 3rd'],
    ['[Week of] MMMM D', 'Week of September 3'],
    ['D.M.YYYY', '3.9.2026'],
  ])('formats %s', (format, expected) => {
    expect(formatDate(date, format)).toBe(expected);
  });

  it('writes ordinals and adds days across months', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
    ]);
    expect(formatDate(addDays(new Date(2026, 8, 30), 1), 'YYYY-MM-DD')).toBe('2026-10-01');
  });
});

describe('Daily notes', () => {
  it('registers its commands', async () => {
    const harness = createTestHarness(plugin, { permissions });
    await harness.activate();
    expect(harness.commands.map((command) => command.id)).toEqual([
      'open-today',
      'open-yesterday',
      'open-tomorrow',
    ]);
    expect(harness.commands[0]?.shortcut).toBe('Mod+Alt+D');
  });

  it('creates today’s note from the template in the folder, then reuses it', async () => {
    const harness = createTestHarness(plugin, { permissions });
    await harness.activate();
    await harness.runCommand('open-today');
    const folder = harness.workspace.all().find((page) => page.title === 'Daily notes');
    const note = harness.workspace.all().find((page) => page.title === '2026-09-24');
    expect(folder).toMatchObject({ parentId: null, icon: '📅' });
    expect(note).toMatchObject({ parentId: folder?.id });
    expect(note?.content).toContain('## Plan');
    expect(harness.openedPages).toEqual([note?.id]);
    await harness.runCommand('open-today');
    expect(harness.workspace.all().filter((page) => page.title === '2026-09-24')).toHaveLength(1);
    expect(harness.openedPages).toEqual([note?.id, note?.id]);
    await harness.runCommand('open-yesterday');
    expect(harness.workspace.get(harness.openedPages.at(-1) ?? '')?.title).toBe('2026-09-23');
  });

  it('uses the date format, the folder setting and an existing folder page', async () => {
    const harness = createTestHarness(plugin, {
      permissions,
      pages: [{ id: 'journal', title: 'Journal' }],
      settings: { dateFormat: 'dddd, MMMM Do', folder: 'Journal' },
    });
    await harness.activate();
    await harness.runCommand('open-tomorrow');
    expect(harness.workspace.get(harness.openedPages[0] ?? '')).toMatchObject({
      title: 'Friday, September 25th',
      parentId: 'journal',
    });
    harness.setSetting('folder', '');
    await harness.runCommand('open-today');
    expect(harness.workspace.get(harness.openedPages[1] ?? '')).toMatchObject({ parentId: null });
  });

  it('creates today’s note on startup when asked, without opening it', async () => {
    const harness = createTestHarness(plugin, { permissions, settings: { autoCreate: true } });
    await harness.activate();
    expect(
      harness.workspace
        .all()
        .map((page) => page.title)
        .sort(),
    ).toEqual(['2026-09-24', 'Daily notes']);
    expect(harness.openedPages).toEqual([]);
  });

  it('tells the user when it can’t write pages', async () => {
    const harness = createTestHarness(plugin, { permissions: ['pages:read', 'ui:commands'] });
    await harness.activate();
    await harness.runCommand('open-today');
    expect(harness.notifications[0]).toMatchObject({
      title: 'Couldn’t open the daily note',
      variant: 'error',
    });
    expect(harness.notifications[0]?.description).toMatch(/permission to create and edit pages/);
  });
});
