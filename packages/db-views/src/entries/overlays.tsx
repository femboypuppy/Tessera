import { overlays, type OverlayState } from '../overlay-store';
import { CsvImportDialog } from '../ui/csv/import-dialog';
import { DatabasePicker } from '../ui/database-picker';
import { SidePeek } from '../ui/side-peek';

/** The overlays' content, loaded the first time one opens. */
export default function DatabaseOverlays({ state }: { state: OverlayState }) {
  return (
    <>
      {state.peek ? (
        <SidePeek key={state.peek.rowId} rowId={state.peek.rowId} onClose={overlays.closePeek} />
      ) : null}
      {state.csvImport ? (
        <CsvImportDialog parentId={state.csvImport.parentId} onClose={overlays.closeCsvImport} />
      ) : null}
      {state.picker ? <DatabasePicker onPick={state.picker.resolve} /> : null}
    </>
  );
}
