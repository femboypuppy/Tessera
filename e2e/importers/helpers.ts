import { crc32, inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, type Locator, type Page } from '@playwright/test';

/** The importer fixtures (`packages/importers/fixtures/<name>`). */
export function fixturePath(name: string): string {
  return fileURLToPath(new URL(`../../packages/importers/fixtures/${name}`, import.meta.url));
}

/**
 * Opens the app and creates an empty workspace through onboarding. The web app keeps workspaces
 * in memory until the storage feature lands, so every test starts here and never reloads.
 */
export async function createWorkspace(page: Page, name: string): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Workspace name').fill(name);
  await page.getByRole('button', { name: 'Create an empty workspace' }).click();
  await expect(page.getByRole('navigation', { name: 'Sidebar' })).toBeVisible();
}

export function sidebar(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Sidebar' });
}

export function pageTree(page: Page): Locator {
  return sidebar(page).getByRole('tree', { name: 'Pages' });
}

export function importDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: /^(Import|Importing…|Import complete)/ });
}

/** Opens the import dialog from the sidebar and picks a folder of the fixtures. */
export async function importFolder(
  page: Page,
  fixture: string,
  options: { source?: string; rootTitle?: string } = {},
): Promise<Locator> {
  await sidebar(page).getByRole('button', { name: 'Import', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Import' });
  await expect(dialog).toBeVisible();
  if (options.source) await dialog.getByRole('radio', { name: options.source }).click();
  await dialog.getByTestId('import-folder-input').setInputFiles(fixturePath(fixture));
  await expect(dialog.getByRole('button', { name: /^Import \d+ files?$/ })).toBeVisible();
  if (options.rootTitle !== undefined)
    await dialog.getByLabel('New page for the import').fill(options.rootTitle);
  return dialog;
}

/** Expands a tree row (by its title) with the keyboard. */
export async function expandTreeItem(page: Page, title: string): Promise<void> {
  const item = pageTree(page).getByRole('treeitem', { name: title, exact: true });
  await item.focus();
  if ((await item.getAttribute('aria-expanded')) === 'false')
    await page.keyboard.press('ArrowRight');
  await expect(item).toHaveAttribute('aria-expanded', 'true');
}

/** Opens a page from the sidebar tree. */
export async function openFromTree(page: Page, title: string): Promise<void> {
  await pageTree(page).getByRole('treeitem', { name: title, exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Page title' })).toHaveValue(title);
}

/**
 * Reads a zip archive: its file names and the text of each entry (stored or deflated), using
 * only Node's zlib.
 */
export function readZip(bytes: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  // The end of central directory record is in the last 64 KB + 22 bytes.
  let end = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new Error('Not a zip archive');
  const count = bytes.readUInt16LE(end + 10);
  let offset = bytes.readUInt32LE(end + 16);
  for (let index = 0; index < count; index += 1) {
    if (bytes.readUInt32LE(offset) !== 0x02014b50) throw new Error('Broken central directory');
    const method = bytes.readUInt16LE(offset + 10);
    const compressedSize = bytes.readUInt32LE(offset + 20);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const localOffset = bytes.readUInt32LE(offset + 42);
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    const localName = bytes.readUInt16LE(localOffset + 26);
    const localExtra = bytes.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localName + localExtra;
    const data = bytes.subarray(start, start + compressedSize);
    files.set(name, method === 8 ? inflateRawSync(data) : Buffer.from(data));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

/** Writes a zip archive with stored (uncompressed) entries: enough to hand a big vault to the app. */
export function writeZip(files: ReadonlyArray<[string, string | Buffer]>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
    const nameBytes = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    // Bit 11: the name is UTF-8.
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const TOPICS = [
  'Protein folding',
  'Battery chemistry',
  'Urban heat islands',
  'Coral reef recovery',
  'Soil carbon',
  'Wind turbine wakes',
  'Glacier retreat',
  'Microplastics',
  'Sleep and memory',
  'Language acquisition',
];
const KINDS = ['reading notes', 'open questions', 'experiment log', 'summary', 'references'];

/**
 * A research vault of `notes` linked notes in topic folders, with frontmatter, tasks, callouts
 * and tables: realistic content for the progress screenshot and the responsiveness check.
 */
export function researchVault(notes: number): Array<[string, string]> {
  const files: Array<[string, string]> = [['Research vault/.obsidian/app.json', '{}']];
  const title = (index: number) => {
    const topic = TOPICS[index % TOPICS.length] ?? 'Notes';
    const kind = KINDS[Math.floor(index / TOPICS.length) % KINDS.length] ?? 'notes';
    const round = Math.floor(index / (TOPICS.length * KINDS.length));
    return `${topic} ${kind}${round ? ` ${round + 1}` : ''}`;
  };
  for (let index = 0; index < notes; index += 1) {
    const topic = TOPICS[index % TOPICS.length] ?? 'Notes';
    const body = [
      '---',
      `tags: [research, ${topic.toLowerCase().replace(/\s+/g, '-')}]`,
      `created: 2026-0${1 + (index % 9)}-1${index % 10}`,
      '---',
      '',
      `Notes on ${topic.toLowerCase()}. Related: [[${title((index + 1) % notes)}]] and [[${title((index + 10) % notes)}|the next round]].`,
      '',
      '## Findings',
      '',
      `- [x] Read the survey paper ^read-${index}`,
      '- [ ] Compare with last year’s measurements',
      '',
      '| Sample | Value | Unit |',
      '| --- | --- | --- |',
      `| A${index} | ${(index * 7) % 100} | mg/L |`,
      '',
      '> [!note] Method',
      '> Measured twice, averaged, and checked against the control.',
    ].join('\n');
    files.push([`Research vault/${topic}/${title(index)}.md`, body]);
  }
  return files;
}
