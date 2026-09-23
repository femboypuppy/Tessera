import { lazy, Suspense } from 'react';
import { useStore } from '../lib/store';
import { pickerStore } from './store';

const WorkspacePicker = lazy(() =>
  import('./WorkspacePicker').then((module) => ({ default: module.WorkspacePicker })),
);

/**
 * The always-mounted overlay (`overlays` in the feature): renders nothing until a command opens the
 * picker, then loads the dialog.
 */
export default function PickerHost() {
  const state = useStore(pickerStore);
  if (!state.open) return null;
  return (
    <Suspense fallback={null}>
      <WorkspacePicker initialView={state.view} />
    </Suspense>
  );
}
