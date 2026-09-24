import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import Database from 'better-sqlite3';
import { newId } from '@tessera/core';
import { DB_FILE } from '../db/database';
import { SERVER_VERSION } from '../http/app';
import { runningServerPid } from '../lock';
import { extractTarGz, writeTarGz, type TarEntry } from './tar';

const MANIFEST = 'backup.json';

interface Manifest {
  format: 'tessera-backup';
  version: 1;
  createdAt: string;
  serverVersion: string;
  assets: number;
}

async function listFiles(root: string, prefix = ''): Promise<string[]> {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory())
      files.push(...(await listFiles(path.join(root, entry.name), relative)));
    else if (entry.isFile()) files.push(relative);
  }
  return files;
}

/**
 * Writes a consistent backup of a data folder to `outFile` (`.tar.gz`): an online SQLite backup
 * (safe while the server runs) plus every asset file. Asset files are written before their
 * database rows, so the backup never references a missing file.
 */
export async function createBackup(
  dataDir: string,
  outFile: string,
): Promise<{ file: string; assets: number; bytes: number }> {
  const dbPath = path.join(dataDir, DB_FILE);
  if (!existsSync(dbPath)) throw new Error(`There is no Tessera database in ${dataDir}.`);
  if (existsSync(outFile)) throw new Error(`${outFile} already exists; choose another file name.`);
  const tmpDir = path.join(dataDir, 'tmp');
  await mkdir(tmpDir, { recursive: true });
  const snapshot = path.join(tmpDir, `backup-${newId()}.db`);
  const source = new Database(dbPath, { fileMustExist: true, readonly: true });
  try {
    await source.backup(snapshot);
  } finally {
    source.close();
  }
  try {
    const assets = await listFiles(path.join(dataDir, 'assets'));
    const manifest: Manifest = {
      format: 'tessera-backup',
      version: 1,
      createdAt: new Date().toISOString(),
      serverVersion: SERVER_VERSION,
      assets: assets.length,
    };
    const entries: TarEntry[] = [
      { name: MANIFEST, data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
      { name: DB_FILE, file: snapshot },
      ...assets.map((relative) => ({
        name: `assets/${relative}`,
        file: path.join(dataDir, 'assets', ...relative.split('/')),
      })),
    ];
    const { bytes } = await writeTarGz(outFile, entries);
    return { file: path.resolve(outFile), assets: assets.length, bytes };
  } finally {
    await rm(snapshot, { force: true });
  }
}

/**
 * Restores a backup into a data folder. The server must be stopped. The current data is moved to
 * `DATA_DIR/pre-restore-<timestamp>/` first, never deleted.
 */
export async function restoreBackup(
  dataDir: string,
  inFile: string,
): Promise<{ assets: number; previous: string | null }> {
  const pid = runningServerPid(dataDir);
  if (pid !== null)
    throw new Error(`A Tessera server (process ${pid}) is using ${dataDir}. Stop it first.`);
  if (!existsSync(inFile)) throw new Error(`${inFile} does not exist.`);
  await mkdir(dataDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const staging = path.join(dataDir, `.restore-${stamp}`);
  try {
    const files = await extractTarGz(inFile, staging);
    if (!files.includes(MANIFEST) || !files.includes(DB_FILE))
      throw new Error('This file is not a Tessera backup.');
    const manifest = JSON.parse(
      await readFile(path.join(staging, MANIFEST), 'utf8'),
    ) as Partial<Manifest>;
    if (manifest.format !== 'tessera-backup' || manifest.version !== 1)
      throw new Error('This backup was made by an incompatible version of Tessera.');
    const check = new Database(path.join(staging, DB_FILE), {
      fileMustExist: true,
      readonly: true,
    });
    try {
      const result = check.pragma('integrity_check', { simple: true });
      if (result !== 'ok') throw new Error(`The backup's database is damaged (${String(result)}).`);
      check.prepare('SELECT MAX(version) FROM schema_migrations').get();
    } finally {
      check.close();
    }

    const existing = [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`, 'assets'].filter((name) =>
      existsSync(path.join(dataDir, name)),
    );
    let previous: string | null = null;
    if (existing.length > 0) {
      previous = path.join(dataDir, `pre-restore-${stamp}`);
      await mkdir(previous, { recursive: true });
      for (const name of existing)
        await rename(path.join(dataDir, name), path.join(previous, name));
    }
    await rename(path.join(staging, DB_FILE), path.join(dataDir, DB_FILE));
    if (existsSync(path.join(staging, 'assets')))
      await rename(path.join(staging, 'assets'), path.join(dataDir, 'assets'));
    return { assets: files.filter((file) => file.startsWith('assets/')).length, previous };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
