/**
 * Copies `examples/plugin-template` into `src/template.json`, which the CLI embeds (a published
 * CLI can't read the repository). `src/index.test.ts` fails when the two differ.
 *
 * Usage: `pnpm --filter create-tessera-plugin sync-template`
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { readTemplateFolder, TEMPLATE_FOLDER } from '../src/template-folder';

const output = fileURLToPath(new URL('../src/template.json', import.meta.url));
const files = readTemplateFolder(TEMPLATE_FOLDER);
const options = (await resolveConfig(output)) ?? {};
writeFileSync(output, await format(JSON.stringify({ files }), { ...options, filepath: output }));
console.info(`Synced ${Object.keys(files).length} files from ${TEMPLATE_FOLDER}`);
