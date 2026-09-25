import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createIndexedContext, type IndexedTestContext } from '../test-utils';
import { PaletteHost } from './host';
import { paletteStore } from './store';

const open: IndexedTestContext[] = [];
afterEach(async () => {
  act(() => paletteStore.close());
  for (const test of open.splice(0)) await test.dispose();
});

describe('PaletteHost', () => {
  it('keeps what is typed while the palette loads, and keeps it out of the page', async () => {
    const test = await createIndexedContext();
    open.push(test);
    test.renderInApp(<PaletteHost />);
    act(() => paletteStore.open());
    // The palette's code is still loading: these keys would reach the page (the editor).
    const typed = ['g', 'a', 'g', 'x', 'Backspace', 'a'].map((key) =>
      fireEvent.keyDown(document.body, { key }),
    );
    expect(typed.every((delivered) => !delivered)).toBe(true);
    // Shortcuts pass through untouched.
    expect(fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true })).toBe(true);
    expect(paletteStore.getState().initialQuery).toBe('gaga');
    const input = await screen.findByRole('combobox', { name: 'Command palette' });
    expect((input as HTMLInputElement).value).toBe('gaga');
    // Once the palette is on screen, its own input takes the keys.
    expect(fireEvent.keyDown(document.body, { key: 'r' })).toBe(true);
    expect(paletteStore.getState().initialQuery).toBe('gaga');
  });
});
