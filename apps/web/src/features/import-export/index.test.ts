import { COMMANDS } from '@tessera/core';
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

  it('contributes the dialogs, their commands, the print view and the entry points', async () => {
    const { ctx, dispose } = await createTestAppContext({ features: [importExportFeature] });
    try {
      expect(ctx.commands.has(COMMANDS.openImport)).toBe(true);
      expect(ctx.commands.has(COMMANDS.openExport)).toBe(true);
      const { contributions } = ctx;
      expect(contributions.list('overlays').map((item) => item.id)).toEqual(['import-export']);
      expect(contributions.list('routes').map(({ path, layout }) => ({ path, layout }))).toEqual([
        { path: '/print/:pageId', layout: 'bare' },
      ]);
      expect(contributions.list('sidebarSections').map((item) => item.id)).toEqual(['import']);
      expect(contributions.list('pageHeaderActions').map((item) => item.id)).toEqual(['export']);
      expect(contributions.list('settingsPanels').map((item) => item.id)).toEqual([
        'import-export',
      ]);
      expect(importExportFeature.onboardingActions?.map((action) => action.title)).toEqual([
        'Open the demo workspace',
        'Import from Notion',
        'Import from Obsidian',
        'Import markdown',
      ]);
    } finally {
      await dispose();
    }
  });
});
