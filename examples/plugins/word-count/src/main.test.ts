// @vitest-environment jsdom
import { createTestHarness } from '@tessera/plugin-api/testing';
import { describe, expect, it } from 'vitest';
import plugin from './main';
import { countText, formatReadingTime, stripMarkdown } from './stats';

const essay = `# Apollo 11

The mission landed on the **Moon** on July 20, 1969.
Read [the flight plan](https://example.com/plan) and [[Mission control|the team]].

- [x] Launch
- [ ] Return`;

describe('counting', () => {
  it('counts what people read, not the markdown syntax', () => {
    expect(stripMarkdown(essay)).not.toMatch(/[#*[\]]/);
    const stats = countText(essay);
    // Apollo 11 (2) / The mission landed on the Moon on July 20 1969 (10) / Read the flight plan
    // and the team (7) / Launch (1) / Return (1)
    expect(stats.words).toBe(21);
    expect(stats.paragraphs).toBe(3);
    expect(stats.charactersNoSpaces).toBeLessThan(stats.characters);
    expect(countText('')).toMatchObject({ words: 0, characters: 0, paragraphs: 0 });
  });

  it('formats reading time', () => {
    expect(formatReadingTime(0.2)).toBe('Under a minute');
    expect(formatReadingTime(4.4)).toBe('4 min');
    expect(formatReadingTime(72)).toBe('1 h 12 min');
    expect(formatReadingTime(120)).toBe('2 h');
  });
});

describe('Word count panel', () => {
  it('adds its panel when it starts', async () => {
    const harness = createTestHarness(plugin, { permissions: ['pages:read', 'ui:panels'] });
    await harness.activate();
    expect(harness.panels).toEqual([{ id: 'count', title: 'Word count', icon: '🔢' }]);
  });

  it('counts the open page and follows edits and navigation', async () => {
    const harness = createTestHarness(plugin, {
      permissions: ['pages:read', 'ui:panels'],
      pages: [
        { id: 'apollo', title: 'Apollo 11', content: essay },
        { id: 'short', title: 'Short', content: 'Two words' },
      ],
      currentPageId: 'apollo',
    });
    const panel = await harness.renderPanel('count');
    const count = () => panel.root.querySelector('[data-testid="word-count"]')?.textContent;
    expect(count()).toBe('21');
    expect(panel.root.textContent).toContain('On “Apollo 11”');
    harness.workspace.setContent('apollo', 'One more line of text');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await harness.flush();
    expect(count()).toBe('5');
    harness.setCurrentPage('short');
    await harness.flush();
    expect(count()).toBe('2');
    harness.setCurrentPage(null);
    await harness.flush();
    expect(panel.root.textContent).toContain('Open a page to count its words.');
    await panel.close();
  });

  it('shows progress towards a word goal', async () => {
    const harness = createTestHarness(plugin, {
      permissions: ['pages:read', 'ui:panels'],
      pages: [{ id: 'p', title: 'Draft', content: 'one two three four five' }],
      currentPageId: 'p',
      settings: { goal: 10 },
    });
    const panel = await harness.renderPanel('count');
    const bar = panel.root.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('5');
    expect(panel.root.textContent).toContain('50% of 10 words');
    harness.setSetting('goal', 5);
    await harness.flush();
    expect(panel.root.textContent).toContain('Goal reached');
  });

  it('explains a missing permission instead of breaking', async () => {
    const harness = createTestHarness(plugin, {
      permissions: ['ui:panels'],
      pages: [{ id: 'p', title: 'Secret', content: 'hidden words' }],
      currentPageId: 'p',
    });
    const panel = await harness.renderPanel('count');
    expect(panel.root.textContent).toContain('doesn’t have permission to read your pages');
    expect(panel.root.querySelector('[data-testid="word-count"]')).toBeNull();
  });
});
