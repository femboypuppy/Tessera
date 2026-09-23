import { updateProperty, type PropertyDefinition } from '@tessera/core';
import { useAppContext } from '@tessera/core/react';
import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Textarea,
  type TranslationKey,
} from '@tessera/ui';
import { AlertTriangle, Sigma } from 'lucide-react';
import { useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { t, type DbViewsStrings } from '../i18n';
import type { DatabaseRef } from '../model/operations';
import { formatDateValue, formatNumber } from '../query/format';
import {
  FORMULA_FUNCTIONS,
  isDateResult,
  previewFormula,
  type FormulaError,
  type FormulaValue,
  type FunctionCategory,
} from '../query/formula';
import type { QueryContext, QueryRow } from '../query/types';
import { PropertyIcon, displayTitle } from './common';
import { runAction } from './hooks';

const MAX_EXPRESSION = 10_000;
const CATEGORIES: readonly FunctionCategory[] = ['logic', 'math', 'text', 'date'];

/** The translated message of a formula error, with its position when it has one. */
export function formulaErrorMessage(error: FormulaError): string {
  const params: Record<string, string | number> = { ...error.params };
  if (error.code === 'typeMismatch') {
    const type = (name: unknown) =>
      t(`formulaType_${String(name) as 'number' | 'text' | 'boolean' | 'date' | 'empty'}`);
    params.expected = type(error.params.expected);
    params.actual = type(error.params.actual);
  }
  const message = t(`formulaError_${error.code}`, params);
  return error.end > error.start
    ? t('formulaErrorAt', { message, position: error.start + 1 })
    : message;
}

/** A formula result as the preview shows it. */
function resultText(value: FormulaValue, ctx: QueryContext): string {
  if (value === null || value === '') return t('formulaEmptyResult');
  if (typeof value === 'number') return formatNumber(value, undefined, ctx.locale);
  if (typeof value === 'boolean') return value ? t('checked') : t('unchecked');
  if (isDateResult(value)) return formatDateValue(value, undefined, ctx);
  return value;
}

/** The description of a function (every catalog function has one; a test checks it). */
function describeFunction(name: string): string {
  return t(`formulaFn_${name}` as TranslationKey<DbViewsStrings>);
}

function quoteName(name: string): string {
  return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Edits a formula property's expression: live errors with their position, a preview for the
 * first rows, and the properties and functions to insert. Saving is disabled while the formula
 * doesn't compile; Ctrl or ⌘ + Enter saves.
 */
export function FormulaDialog({
  open,
  onOpenChange,
  database,
  property,
  properties,
  rows,
  queryCtx,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: DatabaseRef;
  property: PropertyDefinition;
  properties: readonly PropertyDefinition[];
  rows: readonly QueryRow[];
  queryCtx: QueryContext;
}) {
  const ctx = useAppContext();
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const [expression, setExpression] = useState(property.formula?.expression ?? '');
  const preview = useMemo(
    () => previewFormula(expression, property.id, properties, rows, queryCtx),
    [expression, property.id, properties, rows, queryCtx],
  );
  const others = properties.filter((candidate) => candidate.id !== property.id);
  const name = property.name || t('untitled');

  const insert = (text: string) => {
    const element = input.current;
    const start = element?.selectionStart ?? expression.length;
    const end = element?.selectionEnd ?? expression.length;
    const next = `${expression.slice(0, start)}${text}${expression.slice(end)}`.slice(
      0,
      MAX_EXPRESSION,
    );
    setExpression(next);
    requestAnimationFrame(() => {
      element?.focus();
      element?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  const save = () => {
    if (!preview.ok) return;
    runAction(ctx, () => updateProperty(database.doc, property.id, { formula: { expression } }));
    onOpenChange(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = ctx.platform.isApple ? event.metaKey : event.ctrlKey;
    if (event.key === 'Enter' && mod) {
      event.preventDefault();
      save();
    }
  };

  const status = preview.ok ? null : formulaErrorMessage(preview.error);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sigma aria-hidden="true" className="size-4 text-fg-muted" />
            {t('formulaTitle', { name })}
          </DialogTitle>
          <DialogDescription>{t('formulaDescription')}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-3">
          <Textarea
            ref={input}
            aria-label={t('formulaLabel')}
            aria-invalid={status ? true : undefined}
            aria-describedby={`${id}-status ${id}-hint`}
            value={expression}
            maxLength={MAX_EXPRESSION}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={3}
            placeholder={t('formulaPlaceholder')}
            onChange={(event) => setExpression(event.target.value)}
            onKeyDown={onKeyDown}
            className="font-mono text-[13px]"
          />
          <p id={`${id}-hint`} className="-mt-2 text-xs text-fg-subtle">
            {t('formulaShortcut')}
          </p>
          {/* Only errors are announced: the preview changes with every keystroke. */}
          <div id={`${id}-status`} role="status" aria-live="polite">
            {status ? (
              <p className="flex items-start gap-1.5 text-sm text-danger">
                <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                {status}
              </p>
            ) : null}
          </div>
          {preview.ok ? (
            <section aria-labelledby={`${id}-preview`} className="flex flex-col gap-1">
              <h3 id={`${id}-preview`} className="text-xs font-medium text-fg-subtle">
                {t('formulaPreview')}
              </h3>
              {preview.results.length > 0 ? (
                <ul className="flex flex-col gap-0.5 text-sm">
                  {preview.results.map(({ row, outcome }) => (
                    <li key={row.id} className="flex min-w-0 gap-2">
                      <span className="w-40 shrink-0 truncate text-fg-muted">
                        {displayTitle(row.title)}
                      </span>
                      {'error' in outcome ? (
                        <span className="min-w-0 text-danger">
                          {formulaErrorMessage(outcome.error)}
                        </span>
                      ) : (
                        <span className="min-w-0 truncate font-medium text-fg tabular-nums">
                          {resultText(outcome.value, queryCtx)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-fg-subtle">{t('formulaPreviewNoRows')}</p>
              )}
            </section>
          ) : null}
          <div className="grid min-h-0 gap-3 border-t border-border pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <section aria-labelledby={`${id}-properties`} className="flex min-w-0 flex-col gap-1">
              <h3 id={`${id}-properties`} className="text-xs font-medium text-fg-subtle">
                {t('formulaProperties')}
              </h3>
              <ul className="flex max-h-56 flex-col overflow-y-auto">
                {others.map((candidate) => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      aria-label={t('formulaInsert', { name: candidate.name || t('untitled') })}
                      onClick={() => insert(`prop(${quoteName(candidate.name)})`)}
                      className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md px-1.5 text-left text-ui text-fg hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                    >
                      <PropertyIcon type={candidate.type} />
                      <span className="truncate">{candidate.name || t('untitled')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            <section aria-labelledby={`${id}-functions`} className="flex min-w-0 flex-col gap-1">
              <h3 id={`${id}-functions`} className="text-xs font-medium text-fg-subtle">
                {t('formulaFunctions')}
              </h3>
              <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                {CATEGORIES.map((category) => (
                  <div key={category} role="group" aria-label={t(`formulaCategory_${category}`)}>
                    <p className="px-1.5 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
                      {t(`formulaCategory_${category}`)}
                    </p>
                    <ul>
                      {FORMULA_FUNCTIONS.filter((fn) => fn.category === category).map((fn) => (
                        <li key={fn.name}>
                          <button
                            type="button"
                            aria-label={t('formulaInsert', { name: fn.signature })}
                            aria-describedby={`${id}-fn-${fn.name}`}
                            onClick={() => insert(`${fn.name}(`)}
                            className="flex w-full min-w-0 flex-col items-start rounded-md px-1.5 py-1 text-left hover:bg-hover focus-visible:ring-2 focus-visible:ring-focus focus-visible:outline-none"
                          >
                            <code className="font-mono text-xs text-fg">{fn.signature}</code>
                            <span id={`${id}-fn-${fn.name}`} className="text-xs text-fg-muted">
                              {describeFunction(fn.name)}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button variant="primary" onClick={save} disabled={!preview.ok}>
            {t('formulaSave')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
