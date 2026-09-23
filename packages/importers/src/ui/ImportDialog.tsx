import { toError, type Importer, type ImportFile, type ImportReport } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Badge,
  Button,
  Callout,
  cn,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  Input,
  RadioCard,
  RadioGroup,
  Select,
  Spinner,
} from '@tessera/ui';
import {
  Archive,
  CircleCheck,
  CircleX,
  FileText,
  Files,
  Folder,
  FolderOpen,
  Gem,
  NotebookText,
  Paperclip,
  Table2,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type DragEvent } from 'react';
import { t } from '../i18n';
import { CORE_MARKDOWN_ID, IMPORTER_IDS } from '../importers';
import { startImport } from './jobs';
import { groupIssues, overallProgress, phaseLabel } from './labels';
import { dragHasFiles, filesFromDrop, filesFromInput } from './pick';
import {
  suggestRootTitle,
  suggestWorkspaceName,
  summarizeFiles,
  type FileSummary,
  type PreviewEntry,
} from './preview';
import {
  clearImportJob,
  closeImportDialog,
  setPendingRestore,
  useImportExportState,
  type ImportJob,
} from './store';

const SOURCE_ORDER: readonly string[] = [
  IMPORTER_IDS.notion,
  IMPORTER_IDS.obsidian,
  IMPORTER_IDS.markdown,
];

const SOURCE_ICONS: Readonly<Record<string, LucideIcon>> = {
  [IMPORTER_IDS.notion]: NotebookText,
  [IMPORTER_IDS.obsidian]: Gem,
  [IMPORTER_IDS.markdown]: FileText,
  [IMPORTER_IDS.backup]: Archive,
};

const ENTRY_ICONS: Readonly<Record<PreviewEntry['kind'], LucideIcon>> = {
  folder: Folder,
  note: FileText,
  database: Table2,
  file: Paperclip,
};

/** Entries listed in the preview before "and N more". */
const PREVIEW_ENTRIES = 6;
/** Issues listed per group in the report before "and N more". */
const ISSUES_PER_GROUP = 50;

/** The importers the dialog offers: known sources first, the backup last, aliases hidden. */
function offeredImporters(list: readonly Importer[]): Importer[] {
  const hasMarkdown = list.some((importer) => importer.id === IMPORTER_IDS.markdown);
  const rank = (id: string) => {
    const index = SOURCE_ORDER.indexOf(id);
    if (index >= 0) return index;
    return id === IMPORTER_IDS.backup ? 99 : 50;
  };
  return list
    .filter((importer) => !(hasMarkdown && importer.id === CORE_MARKDOWN_ID))
    .sort((a, b) => rank(a.id) - rank(b.id));
}

function sourceHint(id: string | null): string {
  switch (id) {
    case IMPORTER_IDS.notion:
      return t('notionHint');
    case IMPORTER_IDS.obsidian:
      return t('obsidianHint');
    case IMPORTER_IDS.markdown:
      return t('markdownHint');
    case IMPORTER_IDS.backup:
      return t('backupHint');
    default:
      return t('autoHint');
  }
}

function SourceIcon({ id, className }: { id: string; className?: string }) {
  const Icon = SOURCE_ICONS[id] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------------------------
// Choosing files
// ---------------------------------------------------------------------------------------------

function DropZone({ onFiles }: { onFiles: (files: Promise<ImportFile[]>) => void }) {
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const filesInput = useRef<HTMLInputElement | null>(null);
  const folderInput = useRef<HTMLInputElement | null>(null);
  // React has no prop for `webkitdirectory`; set it on the element.
  const setFolderInput = useCallback((node: HTMLInputElement | null) => {
    folderInput.current = node;
    node?.setAttribute('webkitdirectory', '');
  }, []);
  const onDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current += 1;
    setOver(true);
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setOver(false);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!dragHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    depth.current = 0;
    setOver(false);
    onFiles(filesFromDrop(event.dataTransfer));
  };
  const onPicked = (input: HTMLInputElement) => {
    const picked = input.files ? filesFromInput(input.files) : [];
    // Reset, so picking the same files again still fires `change`.
    input.value = '';
    onFiles(Promise.resolve(picked));
  };
  return (
    <div
      data-testid="import-drop-zone"
      data-dropping={over || undefined}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={cn(
        'duration-fast flex flex-col items-center gap-3 rounded-xl border-2 border-dashed px-6 py-9 text-center transition-colors',
        over ? 'border-accent bg-accent-subtle' : 'border-border bg-bg-subtle',
      )}
    >
      <div
        className="flex size-11 items-center justify-center rounded-xl bg-surface text-fg-muted shadow-subtle"
        aria-hidden="true"
      >
        <Upload className="size-5" />
      </div>
      <div>
        <p className="text-sm font-medium text-fg">{over ? t('dropActive') : t('dropTitle')}</p>
        <p className="mt-0.5 text-ui text-fg-muted">{t('dropHint')}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => filesInput.current?.click()}>
          <Files aria-hidden="true" />
          {t('chooseFiles')}
        </Button>
        <Button onClick={() => folderInput.current?.click()}>
          <FolderOpen aria-hidden="true" />
          {t('chooseFolder')}
        </Button>
      </div>
      <input
        ref={filesInput}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        data-testid="import-files-input"
        onChange={(event) => onPicked(event.currentTarget)}
      />
      <input
        ref={setFolderInput}
        type="file"
        multiple
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        data-testid="import-folder-input"
        onChange={(event) => onPicked(event.currentTarget)}
      />
    </div>
  );
}

function SourcePicker({
  importers,
  value,
  onChange,
}: {
  importers: readonly Importer[];
  value: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup
        aria-label={t('sourceLabel')}
        value={value ?? ''}
        onValueChange={onChange}
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {importers.map((importer) => (
          <RadioCard
            key={importer.id}
            value={importer.id}
            label={importer.label}
            icon={<SourceIcon id={importer.id} />}
            className="p-2.5"
          />
        ))}
      </RadioGroup>
      <p className="min-h-10 text-ui text-fg-muted" aria-live="polite">
        {sourceHint(value)}
      </p>
    </div>
  );
}

function SummaryCounts({ summary }: { summary: FileSummary }) {
  const parts = [
    summary.notes ? t('previewNotes', { count: summary.notes }) : null,
    summary.databases ? t('previewDatabases', { count: summary.databases }) : null,
    summary.attachments ? t('previewAttachments', { count: summary.attachments }) : null,
    summary.folders ? t('previewFolders', { count: summary.folders }) : null,
  ].filter((part): part is string => part !== null);
  return (
    <ul className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ui text-fg-muted">
      {parts.map((part, index) => (
        <li key={part} className="flex items-center gap-2">
          {part}
          {/* After each item, so a wrapped line never starts with a dot. */}
          {index < parts.length - 1 ? <span aria-hidden="true">·</span> : null}
        </li>
      ))}
    </ul>
  );
}

function FilePreview({ summary }: { summary: FileSummary }) {
  const shown = summary.entries.slice(0, PREVIEW_ENTRIES);
  const more = summary.entries.length - shown.length;
  return (
    <section
      aria-label={t('previewListLabel')}
      className="overflow-hidden rounded-lg border border-border"
    >
      <div className="flex flex-col gap-1 border-b border-border bg-bg-subtle px-3 py-2.5">
        {summary.root ? (
          <p className="flex min-w-0 items-center gap-2 text-sm font-medium text-fg">
            <FolderOpen className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
            <span className="truncate">{summary.root}</span>
          </p>
        ) : null}
        <SummaryCounts summary={summary} />
      </div>
      <ul className="py-1">
        {shown.map((entry) => {
          const Icon = ENTRY_ICONS[entry.kind];
          return (
            <li key={entry.name} className="flex min-w-0 items-center gap-2 px-3 py-1 text-sm">
              <Icon className="size-4 shrink-0 text-fg-subtle" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-fg">
                {entry.name.replace(/\.(md|markdown|txt)$/i, '')}
              </span>
              {entry.kind === 'folder' ? (
                <span className="shrink-0 text-xs text-fg-subtle">
                  {t('previewItems', { count: entry.files })}
                </span>
              ) : null}
            </li>
          );
        })}
        {more > 0 ? (
          <li className="px-3 py-1 text-ui text-fg-muted">{t('previewMore', { count: more })}</li>
        ) : null}
      </ul>
    </section>
  );
}

type Step =
  | { kind: 'choose' }
  | { kind: 'scanning' }
  | { kind: 'preview'; files: ImportFile[]; summary: FileSummary; detectedId: string | null }
  | { kind: 'empty' }
  | { kind: 'error'; message: string };

/** The first steps: pick a source and files, then check the preview and start. */
function ImportPicker({ initialSource }: { initialSource: string | null }) {
  const ctx = useAppContext();
  const importers = useMemo(() => offeredImporters(ctx.importers.list()), [ctx]);
  const [source, setSource] = useState<string | null>(
    initialSource && importers.some((importer) => importer.id === initialSource)
      ? initialSource
      : null,
  );
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [rootTitle, setRootTitle] = useState('');
  const [titleEdited, setTitleEdited] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [starting, setStarting] = useState(false);
  const scans = useRef(0);
  const importer = importers.find((candidate) => candidate.id === source) ?? null;

  const suggest = (id: string, summary: FileSummary) =>
    suggestRootTitle(id, importers.find((candidate) => candidate.id === id)?.label ?? '', summary);

  const scan = async (pending: Promise<ImportFile[]>) => {
    const scan = ++scans.current;
    setStep({ kind: 'scanning' });
    try {
      const files = await pending;
      if (!files.length) {
        setStep({ kind: 'empty' });
        return;
      }
      const [summary, detected] = await Promise.all([
        summarizeFiles(files),
        ctx.importers.detect(files),
      ]);
      if (scan !== scans.current) return;
      const candidates = detected.filter(({ importer: found }) => importers.includes(found));
      const best = candidates[0]?.importer.id ?? null;
      const kept = source && candidates.some(({ importer: found }) => found.id === source);
      const chosen = (kept ? source : null) ?? best ?? IMPORTER_IDS.markdown;
      const [first] = files;
      if (chosen === IMPORTER_IDS.backup && first) {
        setWorkspaceName(await suggestWorkspaceName(first));
      } else if (summary.notes + summary.databases + summary.attachments === 0) {
        setStep({ kind: 'empty' });
        return;
      }
      setSource(chosen);
      setRootTitle(suggest(chosen, summary));
      setTitleEdited(false);
      setStep({ kind: 'preview', files, summary, detectedId: best });
    } catch (error) {
      if (scan === scans.current) setStep({ kind: 'error', message: toError(error).message });
    }
  };

  const changeSource = (id: string) => {
    setSource(id);
    if (step.kind !== 'preview') return;
    if (!titleEdited) setRootTitle(suggest(id, step.summary));
    const [first] = step.files;
    if (id === IMPORTER_IDS.backup && first)
      void suggestWorkspaceName(first).then(setWorkspaceName, () => undefined);
  };

  const start = async () => {
    if (step.kind !== 'preview' || !importer) return;
    if (importer.id === IMPORTER_IDS.backup) {
      const [file] = step.files;
      if (!file) return;
      setStarting(true);
      try {
        const info = await ctx.services.workspaceRegistry.create({
          name: workspaceName.trim() || (await suggestWorkspaceName(file)),
        });
        setPendingRestore(info.id, file);
        ctx.switchWorkspace(info.id);
      } catch (error) {
        setStarting(false);
        setStep({ kind: 'error', message: toError(error).message });
      }
      return;
    }
    void startImport(
      ctx,
      importer,
      step.files,
      rootTitle.trim() || suggest(importer.id, step.summary),
    );
  };

  const back = () => {
    scans.current += 1;
    setStep({ kind: 'choose' });
  };

  let body;
  let footer = null;
  if (step.kind === 'choose') {
    body = (
      <div className="flex flex-col gap-4">
        <SourcePicker importers={importers} value={source} onChange={setSource} />
        <DropZone onFiles={(files) => void scan(files)} />
      </div>
    );
  } else if (step.kind === 'scanning') {
    body = (
      <div className="flex flex-col items-center gap-3 py-16 text-ui text-fg-muted">
        <Spinner size="lg" label="" />
        <p role="status">{t('scanning')}</p>
      </div>
    );
  } else if (step.kind === 'empty' || step.kind === 'error') {
    body = (
      <EmptyState
        icon={step.kind === 'empty' ? <FolderOpen /> : <CircleX />}
        tone={step.kind === 'error' ? 'danger' : 'neutral'}
        title={step.kind === 'empty' ? t('nothingToImportTitle') : t('readFailedTitle')}
        description={step.kind === 'empty' ? t('nothingToImportHint') : step.message}
        actions={<Button onClick={back}>{t('chooseOtherFiles')}</Button>}
      />
    );
  } else {
    const isBackup = source === IMPORTER_IDS.backup;
    const fileCount = step.summary.notes + step.summary.databases + step.summary.attachments;
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label htmlFor="import-source" className="text-ui font-medium text-fg">
              {t('sourceLabel')}
            </label>
            {source && source === step.detectedId ? (
              <Badge tone="accent">{t('detectedBadge')}</Badge>
            ) : null}
          </div>
          <Select
            id="import-source"
            value={source ?? undefined}
            onValueChange={changeSource}
            options={importers.map((candidate) => ({
              value: candidate.id,
              label: (
                <span className="flex items-center gap-2">
                  <SourceIcon id={candidate.id} className="size-4 text-fg-muted" />
                  {candidate.label}
                </span>
              ),
            }))}
            className="sm:max-w-xs"
          />
          <p className="text-xs text-fg-muted">{sourceHint(source)}</p>
        </div>
        {isBackup ? (
          <>
            <Callout tone="info">{t('restoreHint')}</Callout>
            <Field label={t('workspaceNameLabel')}>
              {(props) => (
                <Input
                  {...props}
                  value={workspaceName}
                  maxLength={100}
                  onChange={(event) => setWorkspaceName(event.target.value)}
                />
              )}
            </Field>
          </>
        ) : (
          <>
            <FilePreview summary={step.summary} />
            {step.summary.ignored ? (
              <p className="-mt-2 text-xs text-fg-muted">
                {t('previewSkipped', { count: step.summary.ignored })}
              </p>
            ) : null}
            <Field label={t('rootTitleLabel')} description={t('rootTitleHint')}>
              {(props) => (
                <Input
                  {...props}
                  value={rootTitle}
                  maxLength={200}
                  onChange={(event) => {
                    setRootTitle(event.target.value);
                    setTitleEdited(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') void start();
                  }}
                />
              )}
            </Field>
          </>
        )}
      </div>
    );
    footer = (
      <DialogFooter>
        <Button variant="ghost" onClick={back} disabled={starting}>
          {t('back')}
        </Button>
        <Button variant="primary" onClick={() => void start()} loading={starting}>
          {isBackup ? t('restoreAction') : t('importAction', { count: fileCount })}
        </Button>
      </DialogFooter>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('importTitle')}</DialogTitle>
        <DialogDescription>{t('importDescription')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="pb-4">{body}</DialogBody>
      {footer}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Progress and report
// ---------------------------------------------------------------------------------------------

function ImportProgressView({ job }: { job: Extract<ImportJob, { status: 'running' }> }) {
  const progress = job.progress;
  const fraction = overallProgress(progress);
  const label = phaseLabel(progress?.phase ?? 'reading');
  const restoring = job.importerId === IMPORTER_IDS.backup;
  return (
    <>
      <DialogHeader>
        <DialogTitle>{restoring ? t('restoringTitle') : t('importingTitle')}</DialogTitle>
        <DialogDescription>{t('keepWorking')}</DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-3 py-6" data-phase={progress?.phase ?? 'reading'}>
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <span className="font-medium text-fg">{label}</span>
          {progress && progress.total > 0 ? (
            <span className="shrink-0 text-ui text-fg-muted tabular-nums">
              {t('progressCount', { done: progress.done, total: progress.total })}
            </span>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fraction * 100)}
          className="h-2 overflow-hidden rounded-full bg-active"
        >
          <div
            className="duration-normal h-full rounded-full bg-accent transition-[width] ease-out"
            style={{ width: `${Math.max(2, fraction * 100)}%` }}
          />
        </div>
        <p className="min-h-5 truncate font-mono text-xs text-fg-subtle">
          {progress?.currentFile ?? ''}
        </p>
      </DialogBody>
      <DialogFooter>
        <Button onClick={job.cancel} disabled={job.cancelled} loading={job.cancelled}>
          {job.cancelled ? t('cancelling') : t('cancelImport')}
        </Button>
      </DialogFooter>
    </>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col rounded-lg border border-border px-3 py-2.5"
      data-testid={`count-${label}`}
    >
      <dt className="order-2 text-xs text-fg-muted">{label}</dt>
      <dd className="order-1 text-lg font-semibold text-fg tabular-nums">
        {new Intl.NumberFormat().format(value)}
      </dd>
    </div>
  );
}

function IssueList({ report }: { report: ImportReport }) {
  const ctx = useAppContext();
  const groups = groupIssues(report.issues);
  const errors = report.issues.filter((issue) => issue.severity === 'error').length;
  const warnings = report.issues.filter(
    (issue) => issue.severity === 'warning' && issue.code !== 'cancelled',
  ).length;
  if (!groups.length) return <Callout tone="success">{t('noIssues')}</Callout>;
  return (
    <section aria-labelledby="import-issues" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="import-issues" className="text-sm font-semibold text-fg">
          {t('issuesTitle')}
        </h3>
        {errors ? <Badge tone="danger">{t('issueErrors', { count: errors })}</Badge> : null}
        {warnings ? <Badge tone="warning">{t('issueWarnings', { count: warnings })}</Badge> : null}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {groups.map((group) => {
          const shown = group.issues.slice(0, ISSUES_PER_GROUP);
          const hidden = group.issues.length - shown.length;
          return (
            <details key={`${group.severity}:${group.label}`} className="group/issue">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none select-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus [&::-webkit-details-marker]:hidden">
                <span
                  className={cn(
                    'size-2 shrink-0 rounded-full',
                    group.severity === 'error' ? 'bg-danger' : 'bg-warning',
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1 text-fg">{group.label}</span>
                <span className="shrink-0 text-ui text-fg-muted tabular-nums">
                  {group.issues.length}
                </span>
              </summary>
              <ul className="flex flex-col gap-1 px-3 pb-3 pl-7">
                {shown.map((issue, index) => {
                  const pageId = issue.pageId;
                  return (
                    <li
                      key={`${issue.file ?? ''}:${index}`}
                      className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-ui"
                    >
                      {issue.file ? (
                        <span className="max-w-full truncate font-mono text-xs text-fg-subtle">
                          {issue.file}
                        </span>
                      ) : null}
                      <span className="min-w-0 text-fg-muted">{issue.message}</span>
                      {pageId && ctx.workspace.getPage(pageId) ? (
                        <Button
                          variant="link"
                          // The link look, without the button size padding.
                          className="h-auto px-0"
                          onClick={() => {
                            closeImportDialog();
                            ctx.navigate(pageId);
                          }}
                        >
                          {t('openIssuePage')}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
                {hidden > 0 ? (
                  <li className="text-ui text-fg-subtle">
                    {t('issueMoreHidden', { count: hidden })}
                  </li>
                ) : null}
              </ul>
            </details>
          );
        })}
      </div>
    </section>
  );
}

function ImportReportView({ report }: { report: ImportReport }) {
  const ctx = useAppContext();
  const restored = report.importerId === IMPORTER_IDS.backup;
  const rootPageId = report.rootPageId;
  const failed =
    !report.cancelled &&
    report.issues.some((issue) => issue.severity === 'error') &&
    report.counts.pages === 0;
  const title = report.cancelled
    ? t('reportCancelledTitle')
    : failed
      ? t('reportFailedTitle')
      : restored
        ? t('reportRestoredTitle')
        : t('reportTitle');
  const open = () => {
    closeImportDialog();
    clearImportJob();
    if (rootPageId) ctx.navigate(rootPageId);
  };
  const trash = () => {
    if (!rootPageId) return;
    ctx.workspace.trashPage(rootPageId);
    closeImportDialog();
    clearImportJob();
    ctx.toast({
      title: t('importTrashed'),
      action: { label: t('undo'), onClick: () => ctx.workspace.restorePage(rootPageId) },
    });
  };
  const counts: Array<[string, number]> = [
    [t('countPages'), report.counts.pages],
    [t('countDatabases'), report.counts.databases],
    [t('countRows'), report.counts.rows],
    [t('countAssets'), report.counts.assets],
    [t('countLinks'), report.counts.links],
    [t('countSkipped'), report.counts.skippedFiles],
  ];
  const Icon = failed ? CircleX : CircleCheck;
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              'size-5 shrink-0',
              failed
                ? 'text-danger-text'
                : report.cancelled
                  ? 'text-fg-muted'
                  : 'text-success-text',
            )}
            aria-hidden="true"
          />
          <DialogTitle>{title}</DialogTitle>
        </div>
        <DialogDescription>
          {report.cancelled
            ? t('reportCancelledHint')
            : t('reportDuration', { seconds: (report.durationMs / 1000).toFixed(1) })}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4 pb-4">
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="import-counts">
          {counts.map(([label, value]) => (
            <Stat key={label} label={label} value={value} />
          ))}
        </dl>
        <IssueList report={report} />
      </DialogBody>
      <DialogFooter className="justify-between">
        {rootPageId && ctx.workspace.getPage(rootPageId) ? (
          <Button variant="ghost" onClick={trash} className="mr-auto">
            {t('moveImportToTrash')}
          </Button>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2">
          {restored ? null : <Button onClick={clearImportJob}>{t('importMore')}</Button>}
          <Button variant="primary" onClick={open}>
            {rootPageId ? t('openImported') : t('done')}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

function ImportFailedView({ message }: { message: string }) {
  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-2">
          <CircleX className="size-5 shrink-0 text-danger-text" aria-hidden="true" />
          <DialogTitle>{t('reportFailedTitle')}</DialogTitle>
        </div>
        <DialogDescription>{message}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button onClick={clearImportJob}>{t('tryAgain')}</Button>
      </DialogFooter>
    </>
  );
}

/** The import dialog: source and files, preview, progress and the import report. */
export default function ImportDialog() {
  const open = useImportExportState((state) => state.importOpen);
  const session = useImportExportState((state) => state.importSession);
  const importerId = useImportExportState((state) => state.importerId);
  const job = useImportExportState((state) => state.job);
  const onOpenChange = (next: boolean) => {
    if (next) return;
    closeImportDialog();
    // A finished import is not shown again; a running one keeps going in the background.
    clearImportJob();
  };
  let content;
  if (job?.status === 'running') content = <ImportProgressView job={job} />;
  else if (job?.status === 'done') content = <ImportReportView report={job.report} />;
  else if (job?.status === 'failed') content = <ImportFailedView message={job.message} />;
  else content = <ImportPicker key={session} initialSource={importerId} />;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="import-dialog">
        {content}
      </DialogContent>
    </Dialog>
  );
}
