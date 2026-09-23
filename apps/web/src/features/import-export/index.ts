import { defineFeature, defineService, SERVICE_PRIORITY } from '@tessera/core';
import {
  CORE_MARKDOWN_ID,
  createBackupExporter,
  createBackupImporter,
  createHtmlExporter,
  createMarkdownExporter,
  createMarkdownImporter,
  createNotionImporter,
  createObsidianImporter,
} from '@tessera/importers';

/**
 * Markdown, import & export (Agent 08). Registers the remark `MarkdownCodec` (priority 50), the
 * importers and the exporters; logic lives in `@tessera/markdown` and `@tessera/importers`.
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
  importers: [
    createNotionImporter(),
    createObsidianImporter(),
    createMarkdownImporter(),
    createBackupImporter(),
    // Replaces core's basic markdown importer for anyone who asks for it by ID.
    createMarkdownImporter(CORE_MARKDOWN_ID),
  ],
  exporters: [
    createMarkdownExporter(),
    createHtmlExporter(),
    createBackupExporter(),
    // Replaces core's basic markdown exporter, so the desktop mirror writes Obsidian markdown.
    createMarkdownExporter(CORE_MARKDOWN_ID),
  ],
});
