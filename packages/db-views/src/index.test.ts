import { describe, expect, it } from 'vitest';
import { FILTER_OPERATORS_BY_TYPE, PROPERTY_TYPES } from '@tessera/core';
import { DB_VIEWS_PACKAGE } from './index';

describe('@tessera/db-views skeleton', () => {
  it('sees every property type and its filter operators', () => {
    expect(DB_VIEWS_PACKAGE).toBe('@tessera/db-views');
    for (const type of PROPERTY_TYPES)
      expect(FILTER_OPERATORS_BY_TYPE[type].length).toBeGreaterThan(0);
  });
});
