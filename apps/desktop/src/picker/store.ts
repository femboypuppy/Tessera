import { createStore } from '../lib/store';

/** Whether the workspace picker is open, and on which screen. */
export type PickerState = { open: false } | { open: true; view: 'list' | 'new' };

export const pickerStore = createStore<PickerState>({ open: false });

export function openPicker(view: 'list' | 'new' = 'list'): void {
  pickerStore.set({ open: true, view });
}

export function closePicker(): void {
  pickerStore.set({ open: false });
}
