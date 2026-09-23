import { build, readDocJSON, writeDocJSON } from '@tessera/core';
import { kitchenSinkDoc } from '@tessera/core/testing';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { openMemoryDatabase, type Db } from '../db/database';
import { DocPersistence } from './persistence';

function withWorkspace(db: Db, id = 'ws1'): void {
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, is_owner, created_at) VALUES ('u', 'u@example.com', 'U', 'x', 1, 0)",
  ).run();
  db.prepare('INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, 0)').run(
    id,
    'W',
    'u',
  );
}

function loadDoc(persistence: DocPersistence, docName: string): Y.Doc {
  const doc = new Y.Doc();
  const state = persistence.load('ws1', docName);
  if (state) Y.applyUpdate(doc, state);
  return doc;
}

function recordInto(persistence: DocPersistence, doc: Y.Doc, docName: string): void {
  doc.on('update', (update: Uint8Array) => persistence.append('ws1', docName, update));
}

describe('DocPersistence', () => {
  it('appends updates and loads them merged', () => {
    const db = openMemoryDatabase();
    withWorkspace(db);
    const persistence = new DocPersistence(db, { compactAfter: 10_000 });
    const source = new Y.Doc();
    recordInto(persistence, source, 'page:a');
    source.getText('t').insert(0, 'Hello');
    source.getText('t').insert(5, ' world');
    expect(persistence.updateCount('ws1', 'page:a')).toBe(2);
    expect(loadDoc(persistence, 'page:a').getText('t').toString()).toBe('Hello world');
    expect(persistence.load('ws1', 'page:none')).toBeNull();
  });

  it('compaction preserves content exactly', () => {
    const db = openMemoryDatabase();
    withWorkspace(db);
    const persistence = new DocPersistence(db, { compactAfter: 10_000 });
    const source = new Y.Doc();
    recordInto(persistence, source, 'page:k');
    writeDocJSON(source, kitchenSinkDoc());
    writeDocJSON(source, build.doc(build.p('Rewritten'), build.heading(2, 'Plan')));
    writeDocJSON(source, kitchenSinkDoc());
    source.getMap('props').set('tags', ['moon']);
    source.getText('t').insert(0, 'abcdef');
    source.getText('t').delete(2, 2);
    const before = persistence.updateCount('ws1', 'page:k');
    expect(persistence.compact('ws1', 'page:k')).toEqual({ before, after: 1 });
    const loaded = loadDoc(persistence, 'page:k');
    expect(readDocJSON(loaded)).toEqual(readDocJSON(source));
    expect(loaded.getMap('props').toJSON()).toEqual({ tags: ['moon'] });
    expect(loaded.getText('t').toString()).toBe('abef');
    expect(Y.encodeStateVector(loaded)).toEqual(Y.encodeStateVector(source));
  });

  it('keeps every update when compaction runs between writes, under load', () => {
    const db = openMemoryDatabase();
    withWorkspace(db);
    const persistence = new DocPersistence(db, { compactAfter: 10_000 });
    const reference = new Y.Doc();
    const writers = Array.from({ length: 5 }, () => new Y.Doc());
    let seed = 42;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let step = 0; step < 2000; step += 1) {
      const writer = writers[Math.floor(random() * writers.length)];
      if (!writer) continue;
      const text = writer.getText('t');
      const capture: Uint8Array[] = [];
      writer.once('update', (update: Uint8Array) => capture.push(update));
      if (random() < 0.7 || text.length === 0)
        text.insert(Math.floor(random() * (text.length + 1)), String(step % 10));
      else text.delete(Math.floor(random() * text.length), 1);
      const update = capture[0];
      if (!update) continue;
      persistence.append('ws1', 'page:load', update);
      Y.applyUpdate(reference, update);
      // Writers learn about each other now and then, so edits interleave like real clients.
      if (random() < 0.2) {
        const other = writers[Math.floor(random() * writers.length)];
        if (other && other !== writer) Y.applyUpdate(other, Y.encodeStateAsUpdate(writer));
      }
      if (random() < 0.05) persistence.compact('ws1', 'page:load');
    }
    persistence.compact('ws1', 'page:load');
    const loaded = loadDoc(persistence, 'page:load');
    expect(loaded.getText('t').toString()).toBe(reference.getText('t').toString());
    expect(Y.encodeStateVector(loaded)).toEqual(Y.encodeStateVector(reference));
  });

  it('compacts busy docs automatically', async () => {
    const db = openMemoryDatabase();
    withWorkspace(db);
    const persistence = new DocPersistence(db, { compactAfter: 20 });
    const source = new Y.Doc();
    recordInto(persistence, source, 'page:busy');
    for (let i = 0; i < 25; i += 1) source.getText('t').insert(0, 'x');
    await vi.waitFor(() => expect(persistence.updateCount('ws1', 'page:busy')).toBeLessThan(10));
    expect(loadDoc(persistence, 'page:busy').getText('t').toString()).toBe('x'.repeat(25));
    source.getText('t').insert(0, 'y');
    source.getText('t').insert(0, 'z');
    expect(persistence.compactBusyDocs(2)).toBe(1);
    expect(persistence.updateCount('ws1', 'page:busy')).toBe(1);
  });

  it('skips a corrupt row instead of losing the whole doc', () => {
    const db = openMemoryDatabase();
    withWorkspace(db);
    const errors: unknown[] = [];
    const persistence = new DocPersistence(db, { onError: (error) => errors.push(error) });
    const source = new Y.Doc();
    recordInto(persistence, source, 'page:c');
    source.getText('t').insert(0, 'kept');
    db.prepare(
      'INSERT INTO doc_updates (workspace_id, doc_name, data, created_at) VALUES (?, ?, ?, 0)',
    ).run('ws1', 'page:c', Buffer.from([0xff, 0xff, 0xff, 0x01, 0x02]));
    expect(loadDoc(persistence, 'page:c').getText('t').toString()).toBe('kept');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('deletes docs for good', () => {
    const db = openMemoryDatabase();
    withWorkspace(db);
    const persistence = new DocPersistence(db);
    const source = new Y.Doc();
    recordInto(persistence, source, 'page:gone');
    source.getText('t').insert(0, 'bye');
    persistence.deleteDoc('ws1', 'page:gone');
    expect(persistence.isDeleted('ws1', 'page:gone')).toBe(true);
    // A straggling update from a client that was still connected changes nothing.
    source.getText('t').insert(0, 'late ');
    expect(persistence.load('ws1', 'page:gone')).toBeNull();
    expect(persistence.listDocs('ws1').map((doc) => doc.name)).not.toContain('page:gone');
  });
});
