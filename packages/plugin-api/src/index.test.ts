import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION } from '@tessera/core';
import { PLUGIN_API_PACKAGE } from './index';

describe('@tessera/plugin-api skeleton', () => {
  it('targets the current plugin API version', () => {
    expect(PLUGIN_API_PACKAGE).toBe('@tessera/plugin-api');
    expect(PLUGIN_API_VERSION).toBe(1);
  });
});
