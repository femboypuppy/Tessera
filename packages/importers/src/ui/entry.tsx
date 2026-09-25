import {
  COMMANDS,
  type AppContext,
  type Command,
  type FeatureRoute,
  type OnboardingActionContribution,
  type PageSectionProps,
  type SettingsPanelContribution,
} from '@tessera/core';
import { IconButton, SidebarItem, Spinner, useIsCompact } from '@tessera/ui';
import {
  ArrowDownUp,
  Download,
  FileDown,
  FileText,
  Gem,
  NotebookText,
  Sparkles,
} from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { createBackupImporter, IMPORTER_IDS } from '../importers';
import { t } from '../i18n/registration';
import { startImport } from './jobs';
import { PRINT_ROUTE } from './routes';
import {
  openExportDialog,
  openImportDialog,
  resetImportExport,
  takePendingRestore,
  useImportExportState,
} from './store';

const ImportDialog = lazy(() => import('./ImportDialog'));
const ExportDialog = lazy(() => import('./ExportDialog'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));

/** The print view (lazy: it brings the HTML renderer and DOMPurify). */
const PrintView = lazy(() => import('./PrintView'));

/** `/print/:pageId`, a bare route: the page as a clean document to print or save as PDF. */
export function importExportRoutes(): FeatureRoute[] {
  return [{ path: PRINT_ROUTE, layout: 'bare', component: PrintView }];
}

/**
 * Always mounted (an overlay contribution): renders nothing until a dialog opens, then loads it.
 * A dialog stays mounted after its first use, so it can animate out.
 */
export function ImportExportOverlay() {
  const importOpen = useImportExportState((state) => state.importOpen);
  const exportOpen = useImportExportState((state) => state.exportOpen);
  const [importUsed, setImportUsed] = useState(false);
  const [exportUsed, setExportUsed] = useState(false);
  if (importOpen && !importUsed) setImportUsed(true);
  if (exportOpen && !exportUsed) setExportUsed(true);
  return (
    <Suspense fallback={null}>
      {importUsed || importOpen ? <ImportDialog /> : null}
      {exportUsed || exportOpen ? <ExportDialog /> : null}
    </Suspense>
  );
}

/** "Import" at the bottom of the sidebar. */
export function ImportSidebarItem() {
  return (
    <SidebarItem
      icon={<Download aria-hidden="true" />}
      label={t('importSidebar')}
      onClick={() => openImportDialog()}
    />
  );
}

/** The "Export page" button in the top bar of an open page. */
export function ExportPageAction({ pageId }: PageSectionProps) {
  // A phone's top bar keeps the page menu, which has "Export…", and leaves this out.
  const compact = useIsCompact();
  if (compact) return null;
  return (
    <IconButton
      label={t('exportPage')}
      icon={<FileDown />}
      onClick={() => openExportDialog(pageId)}
    />
  );
}

/** Settings → Import & export. */
function ImportExportSettings() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      }
    >
      <SettingsPanel />
    </Suspense>
  );
}

/** The "Import & export" section of Settings. */
export function importExportSettingsPanel(): SettingsPanelContribution {
  return {
    id: 'import-export',
    title: t('settingsTitle'),
    description: t('settingsDescription'),
    icon: ArrowDownUp,
    order: 40,
    keywords: ['import', 'export', 'notion', 'obsidian', 'markdown', 'backup', 'restore', 'pdf'],
    component: ImportExportSettings,
  };
}

function stringArg(args: unknown, key: string): string | null {
  if (typeof args !== 'object' || args === null || !(key in args)) return null;
  const value: unknown = (args as Record<string, unknown>)[key];
  return typeof value === 'string' && value ? value : null;
}

/** `COMMANDS.openImport` (args `{ importerId? }`) and `COMMANDS.openExport` (args `{ pageId? }`). */
export function importExportCommands(): Command[] {
  return [
    {
      id: COMMANDS.openImport,
      title: t('importCommand'),
      group: 'workspace',
      icon: Download,
      keywords: ['notion', 'obsidian', 'markdown', 'zip', 'csv', 'restore', 'backup'],
      run: ({ args }) => openImportDialog(stringArg(args, 'importerId')),
    },
    {
      id: COMMANDS.openExport,
      title: t('exportCommand'),
      group: 'workspace',
      icon: FileDown,
      keywords: ['markdown', 'obsidian', 'html', 'pdf', 'print', 'backup', 'zip', 'download'],
      run: ({ args, pageId }) => openExportDialog(stringArg(args, 'pageId') ?? pageId),
    },
  ];
}

/** First-run buttons: the demo workspace and the three imports. */
export function importExportOnboardingActions(): OnboardingActionContribution[] {
  return [
    {
      id: 'demo-workspace',
      title: t('onboardingDemoTitle'),
      description: t('onboardingDemoDescription'),
      icon: Sparkles,
      // The quickest way to see what Tessera does, so it comes first.
      order: 1,
      workspaceName: t('workspaceDemo'),
      run: async (ctx) => (await import('./demo')).openDemo(ctx),
    },
    {
      id: 'import-notion',
      title: t('onboardingNotionTitle'),
      description: t('onboardingNotionDescription'),
      icon: NotebookText,
      order: 10,
      workspaceName: t('workspaceNotion'),
      run: () => openImportDialog(IMPORTER_IDS.notion),
    },
    {
      id: 'import-obsidian',
      title: t('onboardingObsidianTitle'),
      description: t('onboardingObsidianDescription'),
      icon: Gem,
      order: 11,
      workspaceName: t('workspaceObsidian'),
      run: () => openImportDialog(IMPORTER_IDS.obsidian),
    },
    {
      id: 'import-markdown',
      title: t('onboardingMarkdownTitle'),
      description: t('onboardingMarkdownDescription'),
      icon: FileText,
      order: 12,
      workspaceName: t('workspaceMarkdown'),
      run: () => openImportDialog(IMPORTER_IDS.markdown),
    },
  ];
}

/**
 * Runs when a workspace opens: restores a backup waiting for it (the import dialog created the
 * workspace for it). The cleanup cancels a running import when the workspace closes.
 */
export function activateImportExport(ctx: AppContext): () => void {
  const backup = takePendingRestore(ctx.workspace.info.id);
  if (backup) {
    openImportDialog(IMPORTER_IDS.backup);
    void startImport(
      ctx,
      ctx.importers.get(IMPORTER_IDS.backup) ?? createBackupImporter(),
      [backup],
      '',
    );
  }
  return () => resetImportExport();
}
