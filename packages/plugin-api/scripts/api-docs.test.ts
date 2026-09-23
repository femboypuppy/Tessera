import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { API_DOCS_PATH, generateApiDocs } from './api-docs';

describe('API reference', () => {
  it('docs/plugins/api.md matches the TSDoc comments (run `pnpm --filter @tessera/plugin-api docs:api`)', () => {
    const generated = generateApiDocs();
    const written = readFileSync(API_DOCS_PATH, 'utf8').replaceAll('\r\n', '\n');
    expect(written).toBe(generated);
  }, 60_000);

  it('documents every part of the API with its examples', () => {
    const docs = generateApiDocs();
    for (const heading of [
      '### definePlugin',
      '#### `api.pages.get`',
      '#### `api.databases.query`',
      '#### `api.ui.addBlock`',
      '#### `api.storage.onChange`',
      '### PluginError',
      '### createTestHarness',
    ])
      expect(docs).toContain(heading);
    // Overloads are shown together, examples as code, and links resolve to anchors.
    expect(docs).toContain('get<F extends ContentFormat>(id: string, options: { format: F })');
    expect(docs).toContain(
      "api.ui.addPanel({ id: 'word-count', title: 'Word count', icon: '🔢' });",
    );
    expect(docs).toContain('[`PluginDefinition.settings`](#plugindefinition)');
    expect(docs).not.toMatch(/\{@link/);
    // Prose can't open HTML tags (VitePress would try to compile them).
    expect(docs).toContain('"&lt;plugin name&gt;: &lt;title&gt;"');
  }, 60_000);
});
