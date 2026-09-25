import {
  toError,
  type AppContext,
  type ExportContext,
  type ImportContext,
  type ImportFile,
  type ImportProgress,
  type Importer,
  type ImportReport,
} from '@tessera/core';
import { t } from '../i18n/registration';
import { getImportExportState, setImportExportState } from './store';

/** What importers write with, bound to the open workspace. */
export function importContextFor(ctx: AppContext, rootTitle: string): ImportContext {
  return {
    workspace: ctx.workspace,
    loadPageDoc: (id) => ctx.loadPageDoc(id),
    loadDatabaseDoc: (id) => ctx.loadDatabaseDoc(id),
    assets: ctx.services.assetStore,
    codec: ctx.services.markdownCodec,
    parentId: null,
    rootTitle,
    currentUser: ctx.currentUser,
  };
}

/** What exporters read with, bound to the open workspace. */
export function exportContextFor(ctx: AppContext): ExportContext {
  return {
    workspace: ctx.workspace,
    loadPageDoc: (id) => ctx.loadPageDoc(id),
    loadDatabaseDoc: (id) => ctx.loadDatabaseDoc(id),
    assets: ctx.services.assetStore,
    codec: ctx.services.markdownCodec,
  };
}

/** Progress reaches the dialog at most this often (every event would re-render for nothing). */
const PROGRESS_INTERVAL_MS = 80;

/**
 * Runs an import in the background of the open workspace. The dialog shows its progress and
 * report; when the dialog is closed, a toast announces the end instead.
 */
export function startImport(
  ctx: AppContext,
  importer: Importer,
  files: readonly ImportFile[],
  rootTitle: string,
): Promise<ImportReport | null> {
  const current = getImportExportState().job;
  if (current?.status === 'running') return Promise.resolve(null);
  const controller = new AbortController();
  const importerId = importer.id;
  setImportExportState({
    job: {
      status: 'running',
      importerId,
      progress: null,
      cancelled: false,
      cancel: () => {
        const job = getImportExportState().job;
        if (job?.status === 'running') setImportExportState({ job: { ...job, cancelled: true } });
        controller.abort();
      },
    },
  });
  let lastUpdate = 0;
  const onProgress = (progress: ImportProgress) => {
    const now = Date.now();
    const job = getImportExportState().job;
    if (job?.status !== 'running') return;
    const phaseChanged = job.progress?.phase !== progress.phase;
    if (!phaseChanged && now - lastUpdate < PROGRESS_INTERVAL_MS) return;
    lastUpdate = now;
    setImportExportState({ job: { ...job, progress } });
  };
  return importer.run(files, importContextFor(ctx, rootTitle), onProgress, controller.signal).then(
    (report) => {
      setImportExportState({ job: { status: 'done', importerId, report } });
      const rootPageId = report.rootPageId;
      if (!getImportExportState().importOpen && !report.cancelled) {
        ctx.toast({
          title: t('importFinishedToast'),
          description: t('importFinishedToastBody', { count: report.counts.pages }),
          variant: 'success',
          ...(rootPageId
            ? { action: { label: t('openImported'), onClick: () => ctx.navigate(rootPageId) } }
            : {}),
        });
      }
      return report;
    },
    (error: unknown) => {
      const message = toError(error).message;
      setImportExportState({ job: { status: 'failed', importerId, message } });
      if (!getImportExportState().importOpen)
        ctx.toast({ title: t('importFailedToast'), description: message, variant: 'error' });
      return null;
    },
  );
}
