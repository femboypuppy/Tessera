import { once } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

/**
 * A minimal ustar reader and writer (regular files only), enough for backups: no dependency, and
 * the reader refuses any path that could land outside the target folder.
 */

const BLOCK = 512;

function writeString(header: Buffer, value: string, offset: number, length: number): void {
  header.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8');
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  header.write(`${value.toString(8).padStart(length - 1, '0')}\0`, offset, length, 'ascii');
}

/** Splits a long path into ustar `prefix` and `name` at a `/`. */
function splitName(name: string): { prefix: string; name: string } {
  if (Buffer.byteLength(name) <= 100) return { prefix: '', name };
  const index = name.lastIndexOf('/', 155);
  if (index <= 0 || Buffer.byteLength(name.slice(index + 1)) > 100)
    throw new Error(`Path too long for a backup archive: ${name}`);
  return { prefix: name.slice(0, index), name: name.slice(index + 1) };
}

function header(name: string, size: number, mtime: number): Buffer {
  const block = Buffer.alloc(BLOCK);
  const parts = splitName(name);
  writeString(block, parts.name, 0, 100);
  writeOctal(block, 0o644, 100, 8);
  writeOctal(block, 0, 108, 8);
  writeOctal(block, 0, 116, 8);
  writeOctal(block, size, 124, 12);
  writeOctal(block, Math.floor(mtime / 1000), 136, 12);
  block.fill(' ', 148, 156);
  block.write('0', 156, 'ascii');
  block.write('ustar\0', 257, 'ascii');
  block.write('00', 263, 'ascii');
  writeString(block, parts.prefix, 345, 155);
  let sum = 0;
  for (const byte of block) sum += byte;
  block.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return block;
}

/** One file to put in an archive: a path inside it, and bytes or a file on disk. */
export type TarEntry = { name: string; data: Buffer } | { name: string; file: string };

/** Writes a `.tar.gz` with the given entries. */
export async function writeTarGz(outFile: string, entries: TarEntry[]): Promise<{ bytes: number }> {
  const gzip = createGzip({ level: 6 });
  const output = createWriteStream(outFile, { flags: 'wx' });
  const done = pipeline(gzip, output);
  // Errors surface through `done`, awaited at the end.
  done.catch(() => undefined);
  let bytes = 0;
  const write = async (chunk: Buffer) => {
    if (!gzip.write(chunk)) await once(gzip, 'drain');
  };
  for (const entry of entries) {
    if ('data' in entry) {
      await write(header(entry.name, entry.data.length, Date.now()));
      await write(entry.data);
      bytes += entry.data.length;
      const pad = (BLOCK - (entry.data.length % BLOCK)) % BLOCK;
      if (pad) await write(Buffer.alloc(pad));
    } else {
      const info = await stat(entry.file);
      await write(header(entry.name, info.size, info.mtimeMs));
      for await (const chunk of createReadStream(entry.file)) await write(chunk as Buffer);
      bytes += info.size;
      const pad = (BLOCK - (info.size % BLOCK)) % BLOCK;
      if (pad) await write(Buffer.alloc(pad));
    }
  }
  await write(Buffer.alloc(BLOCK * 2));
  gzip.end();
  await done;
  return { bytes };
}

/** A safe relative path for extraction, or null (absolute, `..`, drive letters, NUL). */
export function safeEntryPath(name: string): string | null {
  if (!name || name.includes('\0') || name.includes('\\')) return null;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return null;
  const parts = name.split('/').filter((part) => part !== '' && part !== '.');
  if (parts.length === 0 || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

function readString(block: Buffer, offset: number, length: number): string {
  const slice = block.subarray(offset, offset + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? length : end).toString('utf8');
}

function readOctal(block: Buffer, offset: number, length: number): number {
  const text = readString(block, offset, length).trim();
  return text ? parseInt(text, 8) : 0;
}

/**
 * Extracts a `.tar.gz` into `targetDir`. Only regular files are written; anything whose path
 * could escape `targetDir` aborts the whole extraction. Returns the extracted relative paths.
 */
export async function extractTarGz(inFile: string, targetDir: string): Promise<string[]> {
  const root = path.resolve(targetDir);
  await mkdir(root, { recursive: true });
  const extracted: string[] = [];
  let buffer = Buffer.alloc(0);
  let current: { handle: Awaited<ReturnType<typeof open>>; remaining: number; pad: number } | null =
    null;
  let skip = 0;
  let ended = false;

  const gunzip = createReadStream(inFile).pipe(createGunzip());
  for await (const chunk of gunzip) {
    buffer = Buffer.concat([buffer, chunk as Buffer]);
    for (;;) {
      if (ended) break;
      if (skip > 0) {
        const taken = Math.min(skip, buffer.length);
        buffer = buffer.subarray(taken);
        skip -= taken;
        if (skip > 0) break;
      }
      if (current) {
        const taken = Math.min(current.remaining, buffer.length);
        if (taken > 0) await current.handle.write(buffer.subarray(0, taken));
        buffer = buffer.subarray(taken);
        current.remaining -= taken;
        if (current.remaining > 0) break;
        await current.handle.close();
        skip = current.pad;
        current = null;
        continue;
      }
      if (buffer.length < BLOCK) break;
      const block = buffer.subarray(0, BLOCK);
      buffer = buffer.subarray(BLOCK);
      if (block.every((byte) => byte === 0)) {
        ended = true;
        break;
      }
      const name = readString(block, 0, 100);
      const prefix = readString(block, 345, 155);
      const size = readOctal(block, 124, 12);
      const type = String.fromCharCode(block[156] ?? 48);
      const pad = (BLOCK - (size % BLOCK)) % BLOCK;
      if (type !== '0' && type !== '\0') {
        // Directories, links and anything else are skipped (never followed).
        skip = size + pad;
        continue;
      }
      const relative = safeEntryPath(prefix ? `${prefix}/${name}` : name);
      if (!relative) throw new Error(`Refusing an unsafe path in the archive: ${prefix}/${name}`);
      const destination = path.resolve(root, relative);
      if (!destination.startsWith(root + path.sep))
        throw new Error(`Refusing an unsafe path in the archive: ${relative}`);
      await mkdir(path.dirname(destination), { recursive: true });
      const handle = await open(destination, 'wx');
      extracted.push(relative);
      current = { handle, remaining: size, pad };
      if (size === 0) {
        await handle.close();
        current = null;
        skip = pad;
      }
    }
  }
  if (current) {
    await current.handle.close();
    throw new Error('The backup archive is truncated.');
  }
  return extracted;
}
