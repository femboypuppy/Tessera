import { describe, expect, it } from 'vitest';
import { PLUGIN_API_VERSION } from '@tessera/core';
import { CREATE_PLUGIN_PACKAGE, TEMPLATE_API_VERSION } from './index';

describe('create-tessera-plugin skeleton', () => {
  it('scaffolds plugins for the current plugin API version', () => {
    expect(CREATE_PLUGIN_PACKAGE).toBe('create-tessera-plugin');
    expect(TEMPLATE_API_VERSION).toBe(PLUGIN_API_VERSION);
  });
});
