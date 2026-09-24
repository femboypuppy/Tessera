import type { PropertyType } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  Callout,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  Input,
  Select,
  cn,
} from '@tessera/ui';
import { FileSpreadsheet, Upload } from 'lucide-react';
import { useId, useRef, useState, type DragEvent } from 'react';
import { t } from '../../i18n';
import {
  MAX_CSV_BYTES,
  inferColumns,
  parseCsv,
  type ColumnPlan,
  type CsvTable,
} from '../../csv/csv';
import { importCsvAsDatabase } from '../../model/csv-import';
import { errorMessage, PropertyIcon, typeLabel } from '../common';
import { useQueryContext } from '../hooks';

const IMPORT_TYPES: readonly PropertyType[] = [
  'text',
  'number',
  'select',
  'multiSelect',
  'date',
  'checkbox',
  'url',
  'email',
];

interface Loaded {
  fileName: string;
  table: CsvTable;
  plans: ColumnPlan[];
}

/**
 * Creates a database from a CSV file: pick or drop a file, check the guessed type of every column
 * (change any), name the database, import. Rows land in one go, even for tens of thousands.
 */
export function CsvImportDialog({
  parentId,
  onClose,
}: {
  parentId: string | null;
  onClose: () => void;
}) {
  const ctx = useAppContext();
  const queryCtx = useQueryContext();
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const read = async (file: File) => {
    setError(null);
    if (file.size > MAX_CSV_BYTES) {
      setError(t('importTooLarge', { size: '50 MB' }));
      return;
    }
    try {
      const table = parseCsv(await file.text());
      if (table.headers.length === 0 || table.rows.length === 0) {
        setError(t('importEmpty'));
        return;
      }
      setLoaded({ fileName: file.name, table, plans: inferColumns(table, queryCtx) });
      setTitle(file.name.replace(/\.(csv|tsv|txt)$/i, ''));
    } catch (failure) {
      setError(errorMessage(failure));
    }
  };

  const setTitleColumn = (index: number) =>
    setLoaded((current) => {
      if (!current) return current;
      const inferred = inferColumns(current.table, queryCtx);
      return {
        ...current,
        plans: current.plans.map((plan) => {
          if (plan.index === index) return { index, name: plan.name, type: 'title' };
          if (plan.type === 'title') {
            const guess = inferred.find((candidate) => candidate.index === plan.index);
            return guess && guess.type !== 'title'
              ? guess
              : { index: plan.index, name: plan.name, type: 'text' };
          }
          return plan;
        }),
      };
    });

  const start = async () => {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    try {
      const { page, rowCount } = await importCsvAsDatabase(
        ctx,
        loaded.table,
        loaded.plans,
        { title: title.trim(), parentId },
        queryCtx,
      );
      ctx.toast({
        variant: 'success',
        title: t('importDone', { count: rowCount, title: title.trim() || t('untitledDatabase') }),
      });
      onClose();
      ctx.navigate(page.id);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void read(file);
  };

  const titleIndex = loaded?.plans.find((plan) => plan.type === 'title')?.index ?? 0;
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{t('importCsvTitle')}</DialogTitle>
          <DialogDescription>{t('importCsvHint')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {!loaded ? (
            <div
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                'duration-fast flex flex-col items-center gap-2 rounded-xl border border-dashed border-border-strong px-6 py-10 text-center transition-colors',
                dragging && 'border-accent bg-accent-subtle',
              )}
            >
              <FileSpreadsheet aria-hidden="true" className="size-8 text-fg-subtle" />
              <input
                ref={fileRef}
                id={inputId}
                type="file"
                accept=".csv,.tsv,text/csv,text/tab-separated-values,text/plain"
                className="sr-only"
                aria-label={t('chooseFile')}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void read(file);
                }}
              />
              <Button variant="primary" onClick={() => fileRef.current?.click()}>
                <Upload aria-hidden="true" />
                {t('chooseFile')}
              </Button>
              <p className="text-ui text-fg-muted">{t('dropFile')}</p>
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('databaseTitle')}>
                  {(field) => (
                    <Input
                      {...field}
                      value={title}
                      onChange={(event) => setTitle(event.target.value)}
                    />
                  )}
                </Field>
                <Field label={t('titleColumn')}>
                  {(field) => (
                    <Select
                      id={field.id}
                      value={String(titleIndex)}
                      onValueChange={(value) => setTitleColumn(Number(value))}
                      options={loaded.table.headers.map((header, index) => ({
                        value: String(index),
                        label: header,
                      }))}
                    />
                  )}
                </Field>
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border border-border">
                <table className="w-full text-left text-ui">
                  <thead className="sticky top-0 bg-bg-subtle">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                        {t('column')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                        {t('detectedType')}
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium text-fg-muted">
                        {t('sample')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loaded.plans.map((plan) => {
                      const sample = loaded.table.rows
                        .map((row) => row[plan.index] ?? '')
                        .filter((value) => value.trim())
                        .slice(0, 3)
                        .join(' · ');
                      return (
                        <tr
                          key={plan.index}
                          className="border-t border-border"
                          data-column={plan.name}
                        >
                          <td className="px-3 py-1.5 font-medium text-fg">{plan.name}</td>
                          <td className="px-3 py-1.5">
                            {plan.type === 'title' ? (
                              <span
                                className="flex items-center gap-1.5 text-fg-muted"
                                data-type="title"
                              >
                                <PropertyIcon type="title" />
                                {typeLabel('title')}
                              </span>
                            ) : (
                              <Select
                                size="sm"
                                aria-label={`${t('detectedType')}: ${plan.name}`}
                                value={plan.type}
                                className="w-40"
                                onValueChange={(type) =>
                                  setLoaded((current) =>
                                    current
                                      ? {
                                          ...current,
                                          plans: current.plans.map((candidate) =>
                                            candidate.index === plan.index
                                              ? {
                                                  index: plan.index,
                                                  name: plan.name,
                                                  type: type as PropertyType,
                                                }
                                              : candidate,
                                          ),
                                        }
                                      : current,
                                  )
                                }
                                options={IMPORT_TYPES.map((type) => ({
                                  value: type,
                                  label: (
                                    <span className="flex items-center gap-1.5">
                                      <PropertyIcon type={type} />
                                      {typeLabel(type)}
                                    </span>
                                  ),
                                }))}
                              />
                            )}
                          </td>
                          <td className="max-w-60 truncate px-3 py-1.5 text-fg-muted">{sample}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {error ? (
            <Callout tone="danger" title={t('importFailed')}>
              {error}
            </Callout>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {t('cancel')}
          </Button>
          {loaded ? (
            <Button variant="primary" loading={busy} onClick={() => void start()}>
              {t('importButton', { count: loaded.table.rows.length })}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
