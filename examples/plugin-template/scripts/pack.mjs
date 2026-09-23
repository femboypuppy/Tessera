// Zips dist/ into <id>-<version>.zip: the file people install, and the one a registry links to.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { zipSync } from 'fflate';

const read = (name) => readFileSync(new URL(`../dist/${name}`, import.meta.url));
const manifest = JSON.parse(read('manifest.json').toString('utf8'));
const files = { 'manifest.json': read('manifest.json'), [manifest.entry]: read(manifest.entry) };
if (existsSync(new URL('../dist/README.md', import.meta.url)))
  files['README.md'] = read('README.md');

const name = `${manifest.id}-${manifest.version}.zip`;
writeFileSync(new URL(`../${name}`, import.meta.url), zipSync(files, { level: 9 }));
console.info(`Wrote ${name}`);
