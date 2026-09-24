import { addProperty, getProperty, listProperties, type DocHandle } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { TooltipProvider } from '@tessera/ui';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { en } from '../i18n/en';
import { acquireDatabaseStore } from '../model/store';
import { addRow, createDatabase } from '../model/operations';
import { FORMULA_FUNCTIONS, type FormulaErrorCode } from '../query/formula';
import { testContext } from '../test/fixtures';
import { FormulaDialog, formulaErrorMessage } from './formula-dialog';
import { FormulaError } from '../query/formula';

let app: TestAppContext | null = null;
const handles: DocHandle[] = [];

afterEach(async () => {
  for (const handle of handles.splice(0)) handle.release();
  await app?.dispose();
  app = null;
});

async function setup() {
  app = await createTestAppContext();
  const { page } = await createDatabase(app.ctx, { title: 'Reading list' });
  const handle = await app.ctx.loadDatabaseDoc(page.id);
  handles.push(handle);
  const ref = { id: page.id, doc: handle.doc };
  const pages = addProperty(ref.doc, { name: 'Pages', type: 'number' });
  const formula = addProperty(ref.doc, {
    name: 'Per day',
    type: 'formula',
    formula: { expression: 'prop("Pages") / 30' },
  });
  await addRow(app.ctx, ref, { title: 'Dune', values: { [pages.id]: 688 } });
  const store = acquireDatabaseStore(ref.doc, app.ctx.workspace.pages);
  const rows = store.store.getSnapshot().rows;
  store.release();
  const onOpenChange = vi.fn();
  const { ctx } = app;
  render(
    <AppContextProvider value={ctx}>
      <TooltipProvider>
        <FormulaDialog
          open
          onOpenChange={onOpenChange}
          database={ref}
          property={formula}
          properties={listProperties(ref.doc)}
          rows={rows}
          queryCtx={testContext()}
        />
      </TooltipProvider>
    </AppContextProvider>,
  );
  return { ref, formula, onOpenChange };
}

describe('FormulaDialog', () => {
  it('shows errors, inserts properties, previews and saves', { timeout: 30_000 }, async () => {
    const { ref, formula, onOpenChange } = await setup();
    const user = userEvent.setup();
    const input = screen.getByRole('textbox', { name: 'Formula' });
    expect(input).toHaveValue('prop("Pages") / 30');
    expect(screen.getByText('Dune')).toBeInTheDocument();
    expect(screen.getByText('22.933', { exact: false })).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, 'prop("Pagez")');
    expect(screen.getByRole('status')).toHaveTextContent(
      'There is no property called “Pagez” (at character 1)',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Save formula' })).toBeDisabled();

    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Insert Pages' }));
    expect(input).toHaveValue('prop("Pages")');
    await user.type(input, ' * 2');
    await user.click(screen.getByRole('button', { name: 'Insert round(number, digits)' }));
    expect(input).toHaveValue('prop("Pages") * 2round(');
    await user.clear(input);
    await user.type(input, 'prop("Pages") * 2');
    expect(screen.getByText('1,376')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save formula' }));
    expect(getProperty(ref.doc, formula.id)?.formula?.expression).toBe('prop("Pages") * 2');
    expect(onOpenChange).toHaveBeenCalledWith(false);

    // Ctrl + Enter saves too.
    await user.clear(input);
    await user.type(input, 'prop("Pages") + 1');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() =>
      expect(getProperty(ref.doc, formula.id)?.formula?.expression).toBe('prop("Pages") + 1'),
    );
  });
});

describe('formula strings', () => {
  it('describe every function and explain every error', () => {
    const strings: Record<string, string> = en;
    for (const fn of FORMULA_FUNCTIONS) expect(strings[`formulaFn_${fn.name}`]).toBeTruthy();
    const codes: FormulaErrorCode[] = [
      'unexpectedCharacter',
      'unterminatedString',
      'unexpectedToken',
      'unexpectedEnd',
      'tooDeep',
      'unknownFunction',
      'argumentCount',
      'propertyName',
      'unknownProperty',
      'typeMismatch',
      'divisionByZero',
      'invalidNumber',
      'invalidUnit',
      'textTooLong',
      'circular',
      'tooComplex',
    ];
    for (const code of codes) expect(strings[`formulaError_${code}`]).toBeTruthy();
    expect(
      formulaErrorMessage(
        new FormulaError('typeMismatch', 0, 3, { name: 'abs', expected: 'number', actual: 'text' }),
      ),
    ).toBe('abs needs a number, not text (at character 1)');
    expect(formulaErrorMessage(new FormulaError('unexpectedEnd', 4, 4))).toBe(
      'The formula ends too early',
    );
  });
});
