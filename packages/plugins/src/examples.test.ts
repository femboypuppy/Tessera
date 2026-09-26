import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePluginManifest } from './manifest';
import { parseRegistry } from './registry';

const examples = `${resolve(import.meta.dirname, '../../../examples/plugins')}/`;
const read = (path: string): unknown => JSON.parse(readFileSync(examples + path, 'utf8'));
const names = readdirSync(examples).filter((name) =>
  existsSync(`${examples}${name}/manifest.json`),
);

describe('example plugins', () => {
  it('are the five from the brief', () => {
    expect(names.sort()).toEqual([
      'daily-notes',
      'mermaid',
      'pomodoro',
      'random-page',
      'word-count',
    ]);
  });

  it.each(names)('%s has a valid manifest, a README and tests', (name) => {
    const result = parsePluginManifest(read(`${name}/manifest.json`));
    expect(result.ok ? null : result.error).toBeNull();
    expect(existsSync(`${examples}${name}/README.md`)).toBe(true);
    expect(readdirSync(`${examples}${name}/src`).some((file) => file.endsWith('.test.ts'))).toBe(
      true,
    );
  });

  it('are all listed in the example registry, matching their manifests', () => {
    const registry = parseRegistry(read('registry.json'));
    expect(registry.skipped).toBe(0);
    expect(registry.plugins.map((entry) => entry.id).sort()).toEqual(
      names.map((name) => (read(`${name}/manifest.json`) as { id: string }).id).sort(),
    );
    for (const entry of registry.plugins) {
      const manifest = read(`${entry.id}/manifest.json`) as {
        version: string;
        permissions: string[];
        name: string;
        icon: string;
      };
      expect(entry).toMatchObject({
        version: manifest.version,
        permissions: manifest.permissions,
        name: manifest.name,
        icon: manifest.icon,
        download: `https://femboypuppy.github.io/Tessera-Notes/plugins/${entry.id}-${manifest.version}.zip`,
      });
    }
  });
});
