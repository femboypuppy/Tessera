import { defineFeature } from '@tessera/core';

/**
 * Markdown, import & export (Agent 08). Registers the remark MarkdownCodec (priority 50), importers, exporters, the import and export dialogs and onboarding actions; logic lives in `@tessera/markdown` and `@tessera/importers`.
 *
 * Keep this file thin: registration only, heavy code behind dynamic `import()`.
 * See HANDOFF/architect.md for the contracts this feature plugs into.
 */
export const importExportFeature = defineFeature({ id: 'import-export' });
