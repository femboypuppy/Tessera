import MiniSearch from 'minisearch';
import { describe, expect, it } from 'vitest';
import { SEARCH_PACKAGE } from './index';

describe('@tessera/search skeleton', () => {
  it('has MiniSearch available', () => {
    expect(SEARCH_PACKAGE).toBe('@tessera/search');
    const index = new MiniSearch<{ id: string; title: string }>({ fields: ['title'] });
    index.addAll([{ id: 'a', title: 'Voyager golden record' }]);
    expect(index.search('golden').map((hit) => hit.id)).toEqual(['a']);
  });
});
