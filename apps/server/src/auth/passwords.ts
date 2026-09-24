import argon2 from 'argon2';

/** argon2id parameters. The defaults follow OWASP guidance; tests pass cheaper ones. */
export interface PasswordHashOptions {
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
}

const DEFAULTS: Required<PasswordHashOptions> = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

export function hashPassword(password: string, options: PasswordHashOptions = {}): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id, ...DEFAULTS, ...options });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}
