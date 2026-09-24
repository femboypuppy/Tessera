#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createBackup, restoreBackup } from './cli/backup';
import { createOwner } from './cli/create-owner';
import { ask, askHidden, readStdin } from './cli/prompt';
import { ConfigError, loadConfig, type ServerConfig } from './config';
import { SERVER_VERSION } from './http/app';
import { startServer } from './server';

const USAGE = `Tessera server ${SERVER_VERSION}

Usage: tessera-server [command] [options]

Commands:
  start                       Start the server (the default).
  create-owner                Create the owner account (first run, instead of the web form).
      --email <email> --name <name> [--password-stdin]
  backup <file.tar.gz>        Write a consistent backup of DATA_DIR (safe while running).
  restore <file.tar.gz>       Restore a backup into DATA_DIR (stop the server first).
  help                        Show this help.

Configuration is read from environment variables (PORT, DATA_DIR, PUBLIC_URL, MAX_UPLOAD_MB,
SIGNUP_MODE, LOG_LEVEL, …). See apps/server/README.md.`;

function config(): ServerConfig {
  return loadConfig(process.env);
}

async function start(): Promise<void> {
  const server = await startServer({ config: config() });
  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) {
      console.error(`Received ${signal} again; exiting now.`);
      process.exit(1);
    }
    stopping = true;
    server.services.logger.info({ signal }, 'shutting down');
    server
      .close()
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

async function ownerCommand(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      email: { type: 'string' },
      name: { type: 'string' },
      'password-stdin': { type: 'boolean', default: false },
    },
  });
  const email = values.email ?? (await ask('Email: '));
  const name = values.name ?? (await ask('Name: '));
  let password: string;
  if (values['password-stdin']) password = await readStdin();
  else if (process.env.TESSERA_OWNER_PASSWORD) password = process.env.TESSERA_OWNER_PASSWORD;
  else {
    password = await askHidden('Password (at least 8 characters): ');
    const again = await askHidden('Repeat the password: ');
    if (again !== password) throw new Error('The passwords don’t match.');
  }
  const cfg = config();
  const owner = await createOwner(cfg, { email, name, password });
  console.info(`Created the owner account ${owner.email}. Sign in from the app to get started.`);
}

async function main(): Promise<void> {
  const [command = 'start', ...rest] = process.argv.slice(2);
  switch (command) {
    case 'start':
      await start();
      return;
    case 'create-owner':
      await ownerCommand(rest);
      return;
    case 'backup': {
      const file = rest[0];
      if (!file) throw new Error('Usage: tessera-server backup <file.tar.gz>');
      const result = await createBackup(config().dataDir, file);
      console.info(`Backup written to ${result.file} (${result.assets} assets).`);
      return;
    }
    case 'restore': {
      const file = rest[0];
      if (!file) throw new Error('Usage: tessera-server restore <file.tar.gz>');
      const result = await restoreBackup(config().dataDir, file);
      console.info(
        `Restored ${result.assets} assets and the database.${result.previous ? ` The previous data is in ${result.previous}.` : ''}`,
      );
      return;
    }
    case 'help':
    case '--help':
    case '-h':
      console.info(USAGE);
      return;
    case '--version':
    case '-v':
      console.info(SERVER_VERSION);
      return;
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      process.exit(1);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) console.error(error.message);
  else console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
