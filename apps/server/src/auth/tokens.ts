import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/** A random secret (session tokens, invite tokens): 32 bytes, base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Only hashes of tokens are stored, so a leaked database doesn't leak sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** A short human code for the first-run form: `ABCD-EFGH-JKLM`. */
export function setupCodeValue(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const chars = [...bytes].map((byte) => alphabet[byte % alphabet.length] ?? 'A');
  return [chars.slice(0, 4), chars.slice(4, 8), chars.slice(8, 12)]
    .map((group) => group.join(''))
    .join('-');
}

/** Compares two strings in constant time. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
