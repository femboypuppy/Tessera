/**
 * Content-type detection from the first bytes of a file ("magic numbers"). The server never
 * trusts the declared type: it serves the sniffed one, and only types on the allowlist.
 */

/** File families that share a container format; the declared type picks within the family. */
const ZIP_TYPES = new Set([
  'application/zip',
  'application/epub+zip',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
]);

const TEXT_TYPES = new Set(['text/plain', 'text/markdown', 'text/csv', 'application/json']);

/** Every type the server stores and serves. */
export const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/svg+xml',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
  ...ZIP_TYPES,
  ...TEXT_TYPES,
]);

/** Types shown inline in the browser; everything else downloads. */
export const INLINE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'application/pdf',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
  'audio/wav',
  'audio/webm',
]);

/** Bytes the sniffer looks at. */
export const SNIFF_BYTES = 4096;

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

/** Executables are refused outright, whatever else their bytes look like. */
function isExecutable(head: Uint8Array): boolean {
  return (
    ascii(head, 0, 2) === 'MZ' ||
    startsWith(head, [0x7f, 0x45, 0x4c, 0x46]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xca, 0xfe, 0xba, 0xbe]) ||
    startsWith(head, [0x00, 0x61, 0x73, 0x6d])
  );
}

/** C0 controls other than tab, newlines, form feed and escape: binary data, not text. */
function isBinaryControl(byte: number): boolean {
  return (byte < 0x20 && ![0x09, 0x0a, 0x0c, 0x0d, 0x1b].includes(byte)) || byte === 0x7f;
}

function isUtf8Text(bytes: Uint8Array): boolean {
  if (bytes.includes(0)) return false;
  let controls = 0;
  for (const byte of bytes) if (isBinaryControl(byte)) controls += 1;
  if (controls > bytes.length / 100) return false;
  try {
    // A multi-byte character may be cut at the end of the sample: allow a short tail.
    new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(0, Math.max(0, bytes.length - 3)),
    );
    return true;
  } catch {
    return false;
  }
}

/** Removes a leading byte-order mark. */
function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeSvg(text: string): boolean {
  const trimmed = stripBom(text).trimStart();
  if (trimmed.startsWith('<svg')) return true;
  if (
    !trimmed.startsWith('<?xml') &&
    !trimmed.startsWith('<!--') &&
    !trimmed.startsWith('<!DOCTYPE svg')
  )
    return false;
  return /<svg[\s>]/.test(trimmed);
}

function looksLikeHtml(text: string): boolean {
  return /^\s*(<!doctype html|<html|<head|<body|<script|<iframe)/i.test(stripBom(text));
}

/**
 * The type of a file from its first bytes and the type the client declared, or null when the
 * file is not something the server accepts (executables, HTML, unknown binaries).
 */
export function sniffContentType(head: Uint8Array, declared: string | null): string | null {
  const declaredType = (declared ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (isExecutable(head)) return null;
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(head, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (ascii(head, 0, 6) === 'GIF87a' || ascii(head, 0, 6) === 'GIF89a') return 'image/gif';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WEBP') return 'image/webp';
  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 4) === 'WAVE') return 'audio/wav';
  if (ascii(head, 0, 2) === 'BM' && head.length > 14) return 'image/bmp';
  if (ascii(head, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(head, 4, 4) === 'ftyp') {
    const brand = ascii(head, 8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (brand.startsWith('qt')) return 'video/quicktime';
    if (brand === 'M4A ' || declaredType === 'audio/mp4') return 'audio/mp4';
    if (brand.startsWith('heic') || brand.startsWith('heix') || brand === 'mif1') return null;
    return 'video/mp4';
  }
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3]))
    return declaredType === 'audio/webm' ? 'audio/webm' : 'video/webm';
  if (ascii(head, 0, 4) === 'OggS') return 'audio/ogg';
  if (
    ascii(head, 0, 3) === 'ID3' ||
    startsWith(head, [0xff, 0xfb]) ||
    startsWith(head, [0xff, 0xf3])
  )
    return 'audio/mpeg';
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]))
    return ZIP_TYPES.has(declaredType) ? declaredType : 'application/zip';
  if (isUtf8Text(head)) {
    const text = new TextDecoder().decode(head);
    if (looksLikeSvg(text)) return 'image/svg+xml';
    // HTML runs scripts when opened: never stored, even declared as text.
    if (looksLikeHtml(text)) return null;
    return TEXT_TYPES.has(declaredType) ? declaredType : 'text/plain';
  }
  return null;
}
