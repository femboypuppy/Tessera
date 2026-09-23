import { normalizeImportPath, type ExportSink } from '@tessera/core';
import { strToU8, Zip, ZipDeflate, ZipPassThrough } from 'fflate';

/** Already-compressed formats are stored, not deflated again. */
const STORED = /\.(png|jpe?g|gif|webp|avif|zip|pdf|mp3|mp4|m4a|mov|webm|ogg|woff2?)$/i;

/** An `ExportSink` that streams files into a zip archive. Call `finish()` for the bytes. */
export class ZipExportSink implements ExportSink {
  private readonly chunks: Uint8Array[] = [];
  private readonly zip: Zip;
  private readonly paths = new Set<string>();
  private done: Promise<void>;
  private resolveDone: () => void = () => undefined;
  private rejectDone: (error: Error) => void = () => undefined;
  files = 0;

  constructor() {
    this.done = new Promise((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.zip = new Zip((error, chunk, final) => {
      if (error) {
        this.rejectDone(error);
        return;
      }
      this.chunks.push(chunk);
      if (final) this.resolveDone();
    });
  }

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const normalized = normalizeImportPath(path);
    if (!normalized) throw new TypeError(`Unsafe export path: ${path}`);
    if (this.paths.has(normalized.toLowerCase()))
      throw new Error(`The export wrote ${normalized} twice`);
    this.paths.add(normalized.toLowerCase());
    const bytes = typeof data === 'string' ? strToU8(data) : data;
    const entry = STORED.test(normalized)
      ? new ZipPassThrough(normalized)
      : new ZipDeflate(normalized, { level: 6 });
    this.zip.add(entry);
    entry.push(bytes, true);
    this.files += 1;
  }

  /** Ends the archive and returns it. */
  async finish(): Promise<Uint8Array> {
    this.zip.end();
    await this.done;
    const size = this.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}

/** An `ExportSink` that keeps the one file an exporter writes (HTML, JSON backup). */
export class SingleFileSink implements ExportSink {
  name: string | null = null;
  data: Uint8Array | string | null = null;

  async writeFile(path: string, data: Uint8Array | string): Promise<void> {
    const normalized = normalizeImportPath(path);
    if (!normalized) throw new TypeError(`Unsafe export path: ${path}`);
    this.name = normalized;
    this.data = data;
  }
}
