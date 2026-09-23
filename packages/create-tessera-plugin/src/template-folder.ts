import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** `examples/plugin-template` in this repository (development only). */
export const TEMPLATE_FOLDER = fileURLToPath(
  new URL('../../../examples/plugin-template', import.meta.url),
);

const SKIPPED = new Set(['node_modules', 'dist']);

/** Reads the template folder: relative paths (with `/`) to text contents, sorted. */
export function readTemplateFolder(folder: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (directory: string) => {
    for (const name of readdirSync(directory).sort()) {
      if (SKIPPED.has(name) || name.endsWith('.zip')) continue;
      const path = join(directory, name);
      if (statSync(path).isDirectory()) visit(path);
      else files[relative(folder, path).split(sep).join('/')] = readFileSync(path, 'utf8');
    }
  };
  visit(folder);
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
