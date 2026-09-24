import {
  Awareness,
  build as b,
  writeDocJSON,
  type SyncHandle,
  type SyncStatusInfo,
} from '@tessera/core';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createTestEditor, linkDocs } from '../test-utils';
import { buildRemoteCaret, remoteColor, watchRemoteCursors } from './remote-cursors';

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** A fake sync connection whose status can change, with a real awareness. */
function fakeSync(doc: Y.Doc, status: SyncStatusInfo['status']) {
  const awareness = new Awareness(doc);
  const listeners = new Set<(info: SyncStatusInfo) => void>();
  let current: SyncStatusInfo = { status };
  const handle: SyncHandle = {
    docName: 'page:test',
    awareness,
    getStatus: () => current,
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    whenSynced: () => Promise.resolve(),
    destroy: () => awareness.destroy(),
  };
  return {
    handle,
    awareness,
    setStatus(next: SyncStatusInfo['status']) {
      current = { status: next };
      for (const listener of listeners) listener(current);
    },
  };
}

/** Relays awareness between two clients (what a sync provider does). */
function linkAwareness(a: Awareness, bAwareness: Awareness) {
  const relay =
    (from: Awareness, to: Awareness) =>
    (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      if (origin === 'remote') return;
      const clients = [...changes.added, ...changes.updated, ...changes.removed];
      applyAwarenessUpdate(to, encodeAwarenessUpdate(from, clients), 'remote');
    };
  const ab = relay(a, bAwareness);
  const ba = relay(bAwareness, a);
  a.on('update', ab);
  bAwareness.on('update', ba);
  return () => {
    a.off('update', ab);
    bAwareness.off('update', ba);
  };
}

function setup(status: SyncStatusInfo['status']) {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  writeDocJSON(docA, b.doc(b.paragraph('Hello world')));
  cleanups.push(linkDocs(docA, docB));
  const syncA = fakeSync(docA, status);
  const syncB = fakeSync(docB, status);
  syncA.awareness.setLocalStateField('user', { id: 'u-a', name: 'Ada', color: '#0090ff' });
  syncB.awareness.setLocalStateField('user', { id: 'u-b', name: 'Grace', color: '#e5484d' });
  cleanups.push(linkAwareness(syncA.awareness, syncB.awareness));
  const a = createTestEditor({ doc: docA });
  const bEditor = createTestEditor({ doc: docB });
  cleanups.push(a.destroy, bEditor.destroy);
  cleanups.push(
    watchRemoteCursors(a.editor, syncA.handle),
    watchRemoteCursors(bEditor.editor, syncB.handle),
  );
  return { a: a.editor, b: bEditor.editor, syncA, syncB, elementA: a.element };
}

/** Moves the caret, then waits for the batched awareness update to reach the other editor. */
async function moveCaret(editor: Editor, pos: number) {
  editor.view.focus();
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)));
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe('remote cursors', () => {
  it('show collaborators with their name and color while synced', async () => {
    const { a, b: other, elementA } = setup('synced');
    await moveCaret(other, 6);
    expect(a.isDestroyed).toBe(false);
    const caret = elementA.querySelector<HTMLElement>('.tess-remote-caret');
    expect(caret?.textContent).toContain('Grace');
    expect(caret?.style.getPropertyValue('--tess-remote-color')).toBe('#e5484d');
  });

  it('show nothing and share nothing in local-only mode', async () => {
    const { b: other, elementA, syncB } = setup('local');
    await moveCaret(other, 6);
    expect(elementA.querySelector('.tess-remote-caret')).toBeNull();
    expect(syncB.awareness.getLocalState()?.cursor ?? null).toBeNull();
  });

  it('follow the connection status', async () => {
    const { b: other, elementA, syncA, syncB } = setup('local');
    syncA.setStatus('synced');
    syncB.setStatus('synced');
    await moveCaret(other, 3);
    expect(elementA.querySelector('.tess-remote-caret')).not.toBeNull();
    syncA.setStatus('local');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(elementA.querySelector('.tess-remote-caret')).toBeNull();
  });
});

describe('remote caret builder', () => {
  it('never trusts peer data: invalid colors fall back, names are text', () => {
    expect(remoteColor({ color: 'red; background:url(x)' }, 7)).toMatch(/^#[0-9a-f]{6}$/i);
    const caret = buildRemoteCaret({ name: '<img src=x onerror=alert(1)>', color: '#ffc53d' }, 1);
    expect(caret.querySelector('img')).toBeNull();
    expect(caret.textContent).toContain('<img');
    expect((caret.querySelector('.tess-remote-label') as HTMLElement).style.color).toBe(
      'rgb(31, 30, 29)',
    );
  });
});
