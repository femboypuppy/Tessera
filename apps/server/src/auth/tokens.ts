import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** A random secret (session tokens, invite tokens): 32 bytes, base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Only hashes of tokens are stored, so a leaked database doesn't leak sessions. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The setup code's characters: no `I`, `O`, `0` or `1`, which people misread. */
export const SETUP_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * A short human code for the first-run form: `ABCD-EFGH-JKLM` (60 bits). `randomInt` draws each
 * character uniformly whatever the alphabet's length; `byte % length` is only unbiased while the
 * length divides 256.
 */
export function setupCodeValue(): string {
  const chars = Array.from(
    { length: 12 },
    () => SETUP_CODE_ALPHABET[randomInt(SETUP_CODE_ALPHABET.length)] ?? 'A',
  );
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
