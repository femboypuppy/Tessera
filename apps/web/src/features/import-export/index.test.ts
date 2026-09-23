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
});
