import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import template from './template.json';

/**
 * create-tessera-plugin — scaffolds a Tessera plugin: `pnpm create tessera-plugin my-plugin`.
 *
 * The project is `examples/plugin-template` (embedded in `src/template.json`) with its ID, name and
 * author replaced: a manifest, `src/main.ts`, a test with the SDK's mocked API, a Vite library
 * build, a dev server for live reload, a pack script and a README.
 */

/** The placeholders in the template, replaced when scaffolding. */
export const TEMPLATE_VALUES = { id: 'my-plugin', name: 'My plugin', author: 'Your name' } as const;

/** Plugin IDs: lowercase words separated by `-` or `.` (same rule as the manifest). */
export const PLUGIN_ID_PATTERN = /^[a-z0-9]+(?:[-.][a-z0-9]+)*$/;

/** What to scaffold. */
export interface ScaffoldOptions {
  id: string;
  name: string;
  author: string;
}

/** Turns a folder name into a plugin ID: `My Cool Plugin` → `my-cool-plugin`. */
export function toPluginId(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/[-.]{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 64);
}

/** A readable name from an ID: `word-count` → `Word count`. */
export function toPluginName(id: string): string {
  const words = id.split(/[-.]/).filter(Boolean).join(' ');
  return words ? words[0]?.toUpperCase() + words.slice(1) : 'My plugin';
}

/** Checks scaffold options; returns a message for people, or null when they are fine. */
export function validateOptions(options: ScaffoldOptions): string | null {
  if (options.id.length < 2 || !PLUGIN_ID_PATTERN.test(options.id))
    return `"${options.id}" can't be a plugin ID: use lowercase letters, digits, "-" and "." (at least 2 characters).`;
  if (!options.name.trim() || options.name.length > 60)
    return 'The name must be 1 to 60 characters.';
  if (!options.author.trim() || options.author.length > 100)
    return 'The author must be 1 to 100 characters.';
  if (/["\\\n]/.test(options.name + options.author))
    return 'Names can’t contain quotes, backslashes or line breaks.';
  return null;
}

/** The files of a new plugin project, by relative path. */
export function scaffold(options: ScaffoldOptions): Record<string, string> {
  const error = validateOptions(options);
  if (error) throw new Error(error);
  const replace = (text: string) =>
    text
      .replaceAll(TEMPLATE_VALUES.id, options.id)
      .replaceAll(TEMPLATE_VALUES.name, options.name)
      .replaceAll(TEMPLATE_VALUES.author, options.author);
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(template.files)) files[path] = replace(content);
  return files;
}

/** Writes a scaffolded project into `folder`, which must be empty or missing. */
export function writeProject(folder: string, files: Record<string, string>): void {
  if (existsSync(folder) && readdirSync(folder).length > 0)
    throw new Error(`${folder} isn't empty. Pick a new folder name.`);
  for (const [path, content] of Object.entries(files)) {
    const target = join(folder, ...path.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content);
  }
}
