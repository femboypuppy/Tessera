import { execFileSync } from 'node:child_process';
import { basename, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  scaffold,
  TEMPLATE_VALUES,
  toPluginId,
  toPluginName,
  validateOptions,
  writeProject,
} from './index';

export const USAGE = `Create a Tessera plugin.

Usage:
  pnpm create tessera-plugin <folder> [options]

Options:
  --id <id>          Plugin ID (default: from the folder name, like "word-count")
  --name <name>      Display name (default: from the ID, like "Word count")
  --author <author>  Author (default: your git user.name)
  -h, --help         Show this help`;

function gitUserName(): string | null {
  try {
    const name = execFileSync('git', ['config', 'user.name'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return name || null;
  } catch {
    return null;
  }
}

/** Runs the CLI. Returns the exit code. */
export function run(
  argv: readonly string[],
  options: { cwd?: string; log?: (line: string) => void; author?: () => string | null } = {},
): number {
  const log = options.log ?? ((line: string) => console.log(line));
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        id: { type: 'string' },
        name: { type: 'string' },
        author: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    log(`✖ ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
    return 1;
  }
  const { values, positionals } = parsed;
  const folder = positionals[0];
  if (values.help) {
    log(USAGE);
    return 0;
  }
  if (!folder) {
    log(USAGE);
    return 1;
  }
  const id = values.id ?? toPluginId(basename(resolve(folder)));
  const name = values.name ?? toPluginName(id);
  const author = values.author ?? (options.author ?? gitUserName)() ?? TEMPLATE_VALUES.author;
  const error = validateOptions({ id, name, author });
  if (error) {
    log(`✖ ${error}`);
    return 1;
  }
  const cwd = options.cwd ?? process.cwd();
  const target = resolve(cwd, folder);
  try {
    writeProject(target, scaffold({ id, name, author }));
  } catch (caught) {
    log(`✖ ${caught instanceof Error ? caught.message : String(caught)}`);
    return 1;
  }
  const where = relative(cwd, target) || '.';
  log(
    [
      `✔ Created ${name} (${id}) in ${where}`,
      '',
      'Next:',
      `  cd ${where}`,
      '  pnpm install',
      '  pnpm dev    # then in Tessera: Settings → Plugins → Install plugin → Load a dev plugin',
      '  pnpm test',
      '  pnpm pack   # a .zip anyone can install',
    ].join('\n'),
  );
  return 0;
}
