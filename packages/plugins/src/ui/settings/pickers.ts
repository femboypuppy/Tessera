import type { BundleFile } from '../../bundle';
import { PLUGIN_LIMITS } from '../../constants';

/** A file the user picked. */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/**
 * Opens the file dialog through a temporary `<input type="file">`. Resolves null when the user
 * cancels. Must run from a user gesture (a click or a menu selection).
 */
function pickWithInput(options: {
  accept?: string;
  directory?: boolean;
}): Promise<FileList | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (options.accept) input.accept = options.accept;
    if (options.directory) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.style.display = 'none';
    const done = (files: FileList | null) => {
      input.remove();
      resolve(files && files.length ? files : null);
    };
    input.addEventListener('change', () => done(input.files), { once: true });
    input.addEventListener('cancel', () => done(null), { once: true });
    document.body.append(input);
    input.click();
  });
}

/** Asks for a plugin `.zip`. */
export async function pickZipFile(): Promise<PickedFile | null> {
  const files = await pickWithInput({ accept: '.zip,application/zip' });
  const file = files?.[0];
  if (!file) return null;
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

interface DirectoryHandle {
  kind: 'directory';
  name: string;
  values(): AsyncIterable<DirectoryHandle | FileHandle>;
}

interface FileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
}

const SKIPPED = new Set(['node_modules', '.git', '.DS_Store', '__MACOSX']);

async function readDirectory(
  handle: DirectoryHandle,
  prefix: string,
  files: BundleFile[],
  budget: { bytes: number },
): Promise<void> {
  for await (const entry of handle.values()) {
    if (SKIPPED.has(entry.name) || entry.name.startsWith('.')) continue;
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      await readDirectory(entry, path, files, budget);
    } else {
      if (files.length >= PLUGIN_LIMITS.bundleFiles) return;
      const file = await entry.getFile();
      budget.bytes += file.size;
      if (budget.bytes > PLUGIN_LIMITS.bundleBytes) return;
      files.push({ path, data: new Uint8Array(await file.arrayBuffer()) });
    }
  }
}

/**
 * Asks for a plugin folder: the File System Access API where supported, `<input webkitdirectory>`
 * elsewhere. `node_modules` and hidden files are skipped.
 */
export async function pickFolder(): Promise<{ name: string; files: BundleFile[] } | null> {
  const picker = (
    window as unknown as {
      showDirectoryPicker?: (options?: { mode?: string }) => Promise<DirectoryHandle>;
    }
  ).showDirectoryPicker;
  if (typeof picker === 'function') {
    let handle: DirectoryHandle;
    try {
      handle = await picker.call(window, { mode: 'read' });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return null;
      throw error;
    }
    const files: BundleFile[] = [];
    await readDirectory(handle, '', files, { bytes: 0 });
    return { name: handle.name, files };
  }
  const list = await pickWithInput({ directory: true });
  if (!list) return null;
  const files: BundleFile[] = [];
  let bytes = 0;
  let name = '';
  for (const file of Array.from(list)) {
    const relative = file.webkitRelativePath || file.name;
    const parts = relative.split('/');
    if (!name) name = parts[0] ?? '';
    if (parts.some((part) => SKIPPED.has(part) || part.startsWith('.'))) continue;
    if (files.length >= PLUGIN_LIMITS.bundleFiles) break;
    bytes += file.size;
    if (bytes > PLUGIN_LIMITS.bundleBytes) break;
    files.push({ path: relative, data: new Uint8Array(await file.arrayBuffer()) });
  }
  return { name, files };
}
