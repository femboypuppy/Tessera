import { describe, expect, it } from 'vitest';
import { pluginManifestSchema } from '@tessera/core';
import { PLUGINS_PACKAGE } from './index';

describe('@tessera/plugins skeleton', () => {
  it('validates manifests with the core schema', () => {
    expect(PLUGINS_PACKAGE).toBe('@tessera/plugins');
    const manifest = {
      id: 'word-count',
      name: 'Word count',
      version: '1.0.0',
      apiVersion: 1,
      author: 'Tessera',
      description: 'Counts words.',
      entry: 'main.js',
      permissions: ['pages:read', 'ui:panels'],
    };
    expect(pluginManifestSchema.safeParse(manifest).success).toBe(true);
  });
});
