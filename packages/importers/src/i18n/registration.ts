import { createTranslator } from '@tessera/ui';

/**
 * The `importers` strings the startup bundle needs: importer and exporter labels, the first-run
 * actions, commands, the sidebar item and the import toasts. The whole namespace (`./en.ts`)
 * loads with the dialogs, which keeps the startup bundle small; the keys are also in `en.ts`, so
 * translations cover both (`registration.test.ts`).
 */
export const registration = {
  backupDescription: 'A JSON backup made by Tessera, restored into a new workspace.',
  backupLabel: 'Tessera backup',
  database: 'Database',
  exportBackupDescription: 'Everything in this workspace, restorable into a new workspace.',
  exportBackupLabel: 'JSON backup',
  exportCommand: 'Export…',
  exportHtmlDescription: 'One page as a standalone, styled web page.',
  exportHtmlLabel: 'HTML',
  exportMarkdownDescription:
    'Obsidian-compatible markdown with attachments, properties and databases as CSV.',
  exportMarkdownLabel: 'Markdown (zip)',
  exportPage: 'Export page',
  importCommand: 'Import…',
  importFailedToast: 'The import failed',
  importFinishedToast: 'Import complete',
  importFinishedToastBody_one: '{count} page imported.',
  importFinishedToastBody_other: '{count} pages imported.',
  importSidebar: 'Import',
  markdownDescription: 'Markdown files and folders; CSV files become databases.',
  markdownLabel: 'Markdown',
  needsPlugin: 'This block needs a plugin',
  notionDescription: 'The “Markdown & CSV” export zip, with databases and nested pages.',
  notionLabel: 'Notion',
  obsidianDescription: 'A vault folder or zip: wikilinks, embeds, callouts, properties.',
  obsidianLabel: 'Obsidian',
  onboardingDemoDescription: 'Explore linked notes, a project board and a graph.',
  onboardingDemoTitle: 'Open the demo workspace',
  onboardingMarkdownDescription: 'Any folder of markdown and CSV files.',
  onboardingMarkdownTitle: 'Import markdown',
  onboardingNotionDescription: 'Bring in a “Markdown & CSV” export with its databases.',
  onboardingNotionTitle: 'Import from Notion',
  onboardingObsidianDescription: 'Open a vault with its links, properties and attachments.',
  onboardingObsidianTitle: 'Import from Obsidian',
  openImported: 'Open imported pages',
  settingsDescription: 'Import from Notion, Obsidian and markdown; export and back up',
  settingsTitle: 'Import & export',
  untitled: 'Untitled',
  workspaceDemo: 'Tessera demo',
  workspaceMarkdown: 'Notes',
  workspaceNotion: 'From Notion',
  workspaceObsidian: 'Vault',
} as const;

export const t = createTranslator('importers', registration);
