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
import {
  activateImportExport,
  ExportPageAction,
  ImportExportOverlay,
  importExportCommands,
  importExportOnboardingActions,
  importExportRoutes,
  importExportSettingsPanel,
  ImportSidebarItem,
} from '@tessera/importers/ui';

/**
 * Markdown, import & export (Agent 08). Registers the remark `MarkdownCodec` (priority 50), the
 * importers and exporters, the import and export dialogs (`COMMANDS.openImport`,
 * `COMMANDS.openExport`), the `/print/:pageId` view behind the PDF export, a settings panel and the
 * first-run actions. Logic and UI live in `@tessera/markdown` and `@tessera/importers`.
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
  commands: importExportCommands(),
  overlays: [{ id: 'import-export', component: ImportExportOverlay }],
  routes: importExportRoutes(),
  sidebarSections: [{ id: 'import', position: 'bottom', order: 100, component: ImportSidebarItem }],
  pageHeaderActions: [{ id: 'export', order: 50, component: ExportPageAction }],
  settingsPanels: [importExportSettingsPanel()],
  onboardingActions: importExportOnboardingActions(),
  activate: (ctx) => activateImportExport(ctx),
});
