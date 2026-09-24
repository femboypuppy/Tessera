import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Name of the file that marks a data folder as in use by a running server. */
export const LOCK_FILE = 'server.pid';

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as { code?: string }).code === 'EPERM';
  }
}

/** The PID of a live server using `dataDir`, or null. */
export function runningServerPid(dataDir: string): number | null {
  try {
    const pid = Number(readFileSync(path.join(dataDir, LOCK_FILE), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 && isAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Claims `dataDir` for this process, so two servers never write one database. Throws when a live
 * server holds it. Returns the release function.
 */
export function acquireDataDirLock(dataDir: string): () => void {
  const holder = runningServerPid(dataDir);
  if (holder !== null && holder !== process.pid)
    throw new Error(
      `Another Tessera server (process ${holder}) is using ${dataDir}. Stop it first, or use another DATA_DIR.`,
    );
  const file = path.join(dataDir, LOCK_FILE);
  writeFileSync(file, String(process.pid));
  return () => {
    try {
      if (readFileSync(file, 'utf8').trim() === String(process.pid)) rmSync(file, { force: true });
    } catch {
      // Already gone.
    }
  };
}
