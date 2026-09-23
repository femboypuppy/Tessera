import { createTestAppContext } from '@tessera/core/testing';
import { describe, expect, it } from 'vitest';
import { importExportFeature } from './index';

describe('import-export feature', () => {
  it('provides the remark markdown codec', async () => {
    const { ctx, dispose } = await createTestAppContext({ features: [importExportFeature] });
    try {
      expect(ctx.serviceSources.markdownCodec).toBe('remark');
      const { doc } = ctx.services.markdownCodec.parse('> [!tip] Remember\n> ==this== #idea');
      expect(doc.content[0]).toMatchObject({ type: 'callout', attrs: { tone: 'success' } });
    } finally {
      await dispose();
    }
  });

  it('registers the importers and exporters, replacing the basic markdown ones', async () => {
    const { ctx, dispose } = await createTestAppContext({ features: [importExportFeature] });
    try {
      const importers = ctx.importers.list().map((importer) => importer.id);
      expect(importers).toEqual(
        expect.arrayContaining(['notion', 'obsidian', 'markdown', 'tessera-backup']),
      );
      const exporters = ctx.exporters.list().map((exporter) => exporter.id);
      expect(exporters).toEqual(expect.arrayContaining(['markdown', 'html', 'tessera-backup']));
      // Core's basic entries are replaced by the full ones under the same ID.
      expect(ctx.exporters.get('markdown-basic')?.label).toBe(ctx.exporters.get('markdown')?.label);
      expect(ctx.importers.get('markdown-basic')?.label).toBe(ctx.importers.get('markdown')?.label);
    } finally {
      await dispose();
    }
  });
});
