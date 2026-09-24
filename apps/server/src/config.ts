import path from 'node:path';
import { z } from 'zod';

/** Server configuration, from environment variables (validated at boot). */
export interface ServerConfig {
  port: number;
  host: string;
  dataDir: string;
  /** `https://notes.example.com`: invite links, cookie `Secure`, allowed origin. */
  publicUrl: string | null;
  maxUploadBytes: number;
  signupMode: 'invite' | 'open' | 'closed';
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
  /** Extra origins allowed to call the API with credentials (dev servers, other front ends). */
  corsOrigins: string[];
  /** Trust `X-Forwarded-For` and `X-Forwarded-Proto` (behind a reverse proxy). */
  trustProxy: boolean;
  /** The built web app to serve, or null to auto-detect it next to the server. */
  webDir: string | null;
  /** Sessions last this long without use. */
  sessionDays: number;
  /** A fixed code for the first-run owner form (otherwise a random one is logged). */
  setupCode: string | null;
}

const booleanish = z
  .enum(['1', '0', 'true', 'false', 'yes', 'no', 'on', 'off', ''], {
    error: 'must be true or false',
  })
  .transform((value) => ['1', 'true', 'yes', 'on'].includes(value));

const envSchema = z.object({
  PORT: z.coerce
    .number({ error: 'must be a number' })
    .int('must be a whole number')
    .min(1, 'must be between 1 and 65535')
    .max(65535, 'must be between 1 and 65535')
    .default(8787),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().trim().min(1, 'must be a folder path').default('./data'),
  PUBLIC_URL: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined))
    .pipe(
      z
        .url({ protocol: /^https?$/, error: 'must be an http:// or https:// URL' })
        .transform((value) => new URL(value).origin)
        .optional(),
    ),
  MAX_UPLOAD_MB: z.coerce
    .number({ error: 'must be a number' })
    .positive('must be more than 0')
    .max(2048, 'must be at most 2048')
    .default(25),
  SIGNUP_MODE: z
    .enum(['invite', 'open', 'closed'], { error: 'must be invite, open or closed' })
    .default('invite'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'], {
      error: 'must be one of fatal, error, warn, info, debug, trace, silent',
    })
    .default('info'),
  CORS_ORIGINS: z.string().default(''),
  TRUST_PROXY: booleanish.default(false),
  WEB_DIR: z.string().trim().optional(),
  SESSION_DAYS: z.coerce
    .number({ error: 'must be a number' })
    .int('must be a whole number')
    .min(1, 'must be at least 1')
    .max(365, 'must be at most 365')
    .default(30),
  SETUP_CODE: z.string().trim().min(8, 'must be at least 8 characters').optional(),
});

/** Thrown with every problem listed, in words a person running the server understands. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(
      `The server configuration is invalid:\n${problems.map((problem) => `  - ${problem}`).join('\n')}\nSee apps/server/README.md for every setting.`,
    );
    this.name = 'ConfigError';
  }
}

function parseOrigins(value: string): string[] {
  const origins: string[] = [];
  for (const raw of value.split(',').map((part) => part.trim())) {
    if (!raw) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:' && url.protocol !== 'https:' && url.protocol !== 'tauri:')
        throw new Error('bad protocol');
      origins.push(url.protocol === 'tauri:' ? `tauri://${url.host}` : url.origin);
    } catch {
      throw new ConfigError([
        `CORS_ORIGINS: "${raw}" is not an origin like https://app.example.com`,
      ]);
    }
  }
  return origins;
}

/** Reads and validates the configuration. Only `DATA_DIR` matters for a first start. */
export function loadConfig(env: Record<string, string | undefined> = process.env): ServerConfig {
  const input = Object.fromEntries(
    Object.entries(env).filter(([key, value]) => key in envSchema.shape && value !== undefined),
  );
  const result = envSchema.safeParse(input);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => {
        const key = String(issue.path[0] ?? 'config');
        const got = env[key];
        return `${key} ${issue.message}${got !== undefined ? ` (got "${got}")` : ''}`;
      }),
    );
  }
  const value = result.data;
  return {
    port: value.PORT,
    host: value.HOST,
    dataDir: path.resolve(value.DATA_DIR),
    publicUrl: value.PUBLIC_URL ?? null,
    maxUploadBytes: Math.round(value.MAX_UPLOAD_MB * 1024 * 1024),
    signupMode: value.SIGNUP_MODE,
    logLevel: value.LOG_LEVEL,
    corsOrigins: parseOrigins(value.CORS_ORIGINS),
    trustProxy: value.TRUST_PROXY,
    webDir: value.WEB_DIR ? path.resolve(value.WEB_DIR) : null,
    sessionDays: value.SESSION_DAYS,
    setupCode: value.SETUP_CODE ?? null,
  };
}
