import { DATABASE_DOC_KEYS } from '@tessera/core';
import * as Y from 'yjs';

/** How long an action stays undoable (the toast is gone well before). */
const UNDO_WINDOW_MS = 120_000;

/** A handle to revert one action. */
export interface UndoHandle {
  /** Reverts exactly this action, even after later edits (by anyone). Safe to call twice. */
  undo(): void;
  /** Frees the undo manager without undoing. */
  forget(): void;
}

/**
 * Runs `action` in one transaction on a database doc and returns a handle that reverts exactly
 * that transaction. Each action gets its own `Y.UndoManager` tracking only its own origin, so
 * undoing one deleted property never undoes a later edit or another toast's action.
 *
 * @example
 * const handle = runUndoable(dbDoc, () => deleteProperty(dbDoc, propertyId));
 * ctx.toast({ title: t('propertyDeleted'), action: { label: t('undo'), onClick: handle.undo } });
 */
export function runUndoable(db: Y.Doc, action: () => void): UndoHandle {
  const origin = { databasesUndo: true };
  const scope = Object.values(DATABASE_DOC_KEYS).map((key) => db.getMap<unknown>(key));
  const manager = new Y.UndoManager(scope, {
    trackedOrigins: new Set([origin]),
    captureTimeout: 0,
  });
  let done = false;
  const timer = setTimeout(() => forget(), UNDO_WINDOW_MS);
  const forget = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    manager.destroy();
  };
  try {
    db.transact(action, origin);
  } catch (error) {
    // Yjs keeps what an aborted transaction already wrote; revert it before reporting.
    manager.undo();
    forget();
    throw error;
  }
  return {
    undo: () => {
      if (done) return;
      manager.undo();
      forget();
    },
    forget,
  };
}
