import { createRequire } from 'node:module';
import pino, { type Logger } from 'pino';
import type { ServerConfig } from './config';

/** Whether `pino-pretty` is installed (a dev dependency: absent in production images). */
function hasPrettyPrinter(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

/**
 * Structured JSON logs (pino). In an interactive terminal during development they are
 * pretty-printed. Credentials never appear in logs.
 */
export function createLogger(config: Pick<ServerConfig, 'logLevel'>): Logger {
  const pretty =
    process.stdout.isTTY === true && process.env.NODE_ENV !== 'production' && hasPrettyPrinter();
  return pino({
    level: config.logLevel,
    base: { service: 'tessera-server' },
    redact: {
      paths: [
        '*.password',
        '*.token',
        '*.cookie',
        '*.authorization',
        'headers.cookie',
        'headers.authorization',
      ],
      censor: '[redacted]',
    },
    ...(pretty
      ? {
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss' },
          },
        }
      : {}),
  });
}
