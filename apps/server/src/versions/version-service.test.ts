import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { openMemoryDatabase } from '../db/database';
import { WorkspaceService } from '../workspaces/workspace-service';
import { VersionService } from './version-service';

function setup() {
  const db = openMemoryDatabase();
  db.prepare(
    "INSERT INTO users (id, email, name, password_hash, created_at) VALUES ('u1', 'ada@example.com', 'Ada', 'x', 0)",
  ).run();
  const workspace = new WorkspaceService(db).create({ name: 'Apollo', ownerId: 'u1' });
  const versions = new VersionService(db);
  const doc = new Y.Doc();
  doc.getText('t').insert(0, 'Draft');
  const state = Y.encodeStateAsUpdate(doc);
  const save = (id: string, label: string, createdAt: number) =>
    versions.create(workspace.id, {
      id,
      docName: 'page:plan',
      createdAt,
      createdBy: 'u1',
      authorName: 'Ada',
      label,
      kind: 'manual',
      state,
    });
  return { workspace, versions, save };
}

describe('VersionService', () => {
  it('lists newest first, and versions from the same millisecond in upload order', () => {
    const { workspace, versions, save } = setup();
    // IDs sort against the upload order, so only a real tiebreaker gets this right.
    save('zz-first', 'First', 1000);
    save('mm-second', 'Second', 1000);
    save('aa-third', 'Third', 1000);
    save('older', 'Older', 999);
    const labels = versions.list(workspace.id, 'page:plan').map((version) => version.label);
    expect(labels).toEqual(['Third', 'Second', 'First', 'Older']);
  });
});
