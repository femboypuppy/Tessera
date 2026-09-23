import { extractLinks, validateDocJSON } from '@tessera/core';
import { createTestAppContext } from '@tessera/core/testing';
import { describe, expect, it } from 'vitest';
import { generateWorkspace, keystrokes } from './generator';
import { applyGeneratedWorkspace } from './seed';

describe('generateWorkspace', () => {
  it('is deterministic for a seed', () => {
    expect(generateWorkspace({ pages: 120, seed: 7 })).toEqual(
      generateWorkspace({ pages: 120, seed: 7 }),
    );
    expect(generateWorkspace({ pages: 120, seed: 8 })).not.toEqual(
      generateWorkspace({ pages: 120, seed: 7 }),
    );
  });

  it('produces valid documents, a valid tree and links to existing pages', () => {
    const { pages } = generateWorkspace({ pages: 400, seed: 3 });
    expect(pages).toHaveLength(400);
    const ids = new Set(pages.map((page) => page.id));
    expect(ids.size).toBe(400);
    let links = 0;
    for (const page of pages) {
      expect(validateDocJSON(page.doc).ok).toBe(true);
      if (page.parentId) expect(ids.has(page.parentId)).toBe(true);
      for (const link of extractLinks(page.doc)) {
        expect(ids.has(link.targetPageId)).toBe(true);
        links += 1;
      }
    }
    expect(links).toBeGreaterThan(400);
    expect(pages.filter((page) => page.tags.length > 0).length).toBeGreaterThan(200);
    expect(pages.some((page) => page.aliases.length > 0)).toBe(true);
  });

  it('seeds an open workspace', async () => {
    const test = await createTestAppContext();
    const generated = generateWorkspace({ pages: 30, seed: 5 });
    await applyGeneratedWorkspace(test.ctx, generated, { now: Date.UTC(2026, 8, 1) });
    const snapshot = test.ctx.workspace.pages.getSnapshot();
    expect(snapshot.size).toBe(30);
    const first = generated.pages[1];
    if (!first) throw new Error('no page');
    expect(snapshot.get(first.id)?.title).toBe(first.title);
    await test.dispose();
  });

  it('splits a phrase into keystrokes', () => {
    expect(keystrokes('Ky o')).toEqual(['K', 'Ky', 'Ky ', 'Ky o']);
  });
});
