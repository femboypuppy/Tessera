import { defineFeature, defineService, SERVICE_PRIORITY } from '@tessera/core';

/**
 * Markdown, import & export (Agent 08). Registers the remark `MarkdownCodec` (priority 50);
 * logic lives in `@tessera/markdown` and `@tessera/importers`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 */
export const importExportFeature = defineFeature({
  id: 'import-export',
  services: [
    defineService({
      provides: 'markdownCodec',
      id: 'remark',
      priority: SERVICE_PRIORITY.browser,
      // unified and remark load here, in the service's async `create`, not in the startup bundle.
      create: async () => (await import('@tessera/markdown')).createMarkdownCodec(),
    }),
  ],
});
