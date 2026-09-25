import { importFileFromBytes, importFileFromText } from '@tessera/core';
import { describe, expect, it } from 'vitest';
import { createBackupImporter } from '../importers';
import { filesFromDrop, filesFromInput } from './pick';
import { suggestRootTitle, suggestWorkspaceName, summarizeFiles, summarizePaths } from './preview';

describe('summarizePaths', () => {
  it('counts notes, databases, attachments and folders under the common root', () => {
    const summary = summarizePaths([
      'Vault/.obsidian/app.json',
      'Vault/.trash/Old.md',
      'Vault/Welcome.md',
      'Vault/Projects/Apollo.md',
      'Vault/Projects/Archive/1969.md',
      'Vault/Reading list.csv',
      'Vault/attachments/moon.png',
    ]);
    expect(summary).toMatchObject({
      picked: 7,
      notes: 3,
      databases: 1,
      attachments: 1,
      folders: 3,
      ignored: 2,
      root: 'Vault',
    });
    // Folders first, then files, in natural order.
    expect(summary.entries.map((entry) => `${entry.kind}:${entry.name}:${entry.files}`)).toEqual([
      'folder:attachments:1',
      'folder:Projects:2',
      'database:Reading list.csv:1',
      'note:Welcome.md:1',
    ]);
  });

  it('counts a Notion database once, not with its `_all` twin', () => {
    const summary = summarizePaths(['Tasks abc.csv', 'Tasks abc_all.csv', 'Home abc.md']);
    expect(summary.databases).toBe(1);
    expect(summary.root).toBeNull();
    expect(summary.entries.map((entry) => entry.name)).toEqual(['Home abc.md', 'Tasks abc.csv']);
  });
});

describe('suggestions', () => {
  const summary = summarizePaths(['Garden/Roses.md']);

  it('names the import after its folder, Notion imports after Notion', () => {
    expect(suggestRootTitle('obsidian', 'Obsidian', summary)).toBe('Garden');
    expect(suggestRootTitle('notion', 'Notion', summary)).toBe('Notion import');
    expect(suggestRootTitle('markdown', 'Markdown', summarizePaths(['a.md', 'b.md']))).toBe(
      'Markdown import',
    );
    expect(
      suggestRootTitle('markdown', 'Markdown', {
        ...summary,
        root: 'Export-5b1c2d3e-aaaa-bbbb-cccc-1234567890ab',
      }),
    ).toBe('Markdown import');
  });

  it('reads the workspace name of a backup, pretty-printed or not', async () => {
    const compact = importFileFromText(
      'Personal backup 2026-09-23.json',
      JSON.stringify({
        format: 'tessera-backup',
        version: 1,
        createdAt: 'x',
        workspace: { id: 'w1', name: 'Personal "Home"' },
      }),
    );
    expect(await suggestWorkspaceName(compact)).toBe('Personal "Home" (restored)');
    const pretty = importFileFromText(
      'Work backup.json',
      JSON.stringify(
        {
          format: 'tessera-backup',
          version: 1,
          createdAt: 'x',
          workspace: { id: 'w2', name: 'Work' },
        },
        null,
        2,
      ),
    );
    expect(await suggestWorkspaceName(pretty)).toBe('Work (restored)');
    expect(await createBackupImporter().detect([pretty])).toBe(1);
    expect(await createBackupImporter().detect([compact])).toBe(1);
    expect(
      await createBackupImporter().detect([importFileFromText('notes.json', '{"format":"other"}')]),
    ).toBe(0);
    expect(await suggestWorkspaceName(importFileFromText('Old backup.json', '{}'))).toBe(
      'Old backup (restored)',
    );
  });
});

describe('picking files', () => {
  it('keeps folder paths from folder pickers and drops unsafe ones', () => {
    const inFolder = new File(['# A'], 'A.md');
    Object.defineProperty(inFolder, 'webkitRelativePath', { value: 'Vault/Notes/A.md' });
    const loose = new File(['# B'], 'B.md');
    const escaping = new File(['x'], 'evil.md');
    Object.defineProperty(escaping, 'webkitRelativePath', { value: '../evil.md' });
    const files = filesFromInput([inFolder, loose, escaping]);
    expect(files.map((file) => file.path)).toEqual(['Vault/Notes/A.md', 'B.md']);
  });

  it('walks dropped folders, reading every batch of entries', async () => {
    const file = (name: string, fullPath: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      fullPath,
      file: (resolve: (file: File) => void) => resolve(new File([name], name)),
    });
    // Directory readers return entries in batches, then an empty batch.
    const directory = (fullPath: string, batches: unknown[][]) => ({
      isFile: false,
      isDirectory: true,
      fullPath,
      createReader: () => {
        let call = 0;
        return {
          readEntries: (resolve: (entries: unknown[]) => void) => resolve(batches[call++] ?? []),
        };
      },
    });
    const vault = directory('/Vault', [
      [file('A.md', '/Vault/A.md')],
      [directory('/Vault/Sub', [[file('B.md', '/Vault/Sub/B.md')]])],
    ]);
    const transfer = {
      items: [{ kind: 'file', webkitGetAsEntry: () => vault }],
      files: [],
      types: ['Files'],
    } as unknown as DataTransfer;
    const files = await filesFromDrop(transfer);
    expect(files.map((entry) => entry.path)).toEqual(['Vault/A.md', 'Vault/Sub/B.md']);
    expect(await files[1]?.text()).toBe('B.md');
  });
});

describe('summarizeFiles', () => {
  it('names zips that cannot be opened instead of calling them empty', async () => {
    const damaged = importFileFromBytes(
      'Notes export.zip',
      new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00, 1, 2, 3]),
      'application/zip',
    );
    const note = importFileFromText('Loose note.md', '# Loose note');
    const summary = await summarizeFiles([damaged, note]);
    expect(summary.unreadable).toEqual(['Notes export.zip']);
    expect(summary.notes).toBe(1);
  });
});
