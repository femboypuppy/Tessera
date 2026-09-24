import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pluginManifestSchema, PLUGIN_API_VERSION } from '@tessera/core';
import { afterEach, describe, expect, it } from 'vitest';
import { scaffold, TEMPLATE_VALUES, toPluginId, toPluginName, validateOptions } from './index';
import { run } from './run';
import template from './template.json';
import { readTemplateFolder, TEMPLATE_FOLDER } from './template-folder';

const folders: string[] = [];
const tempFolder = () => {
  const folder = mkdtempSync(join(tmpdir(), 'tessera-plugin-'));
  folders.push(folder);
  return folder;
};

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

describe('the embedded template', () => {
  it('is exactly examples/plugin-template (run `pnpm --filter create-tessera-plugin sync-template`)', () => {
    expect(template.files).toEqual(readTemplateFolder(TEMPLATE_FOLDER));
  });

  it('scaffolds the template itself when given its own values', () => {
    expect(scaffold(TEMPLATE_VALUES)).toEqual(template.files);
  });

  it('has everything a plugin project needs', () => {
    expect(Object.keys(template.files).sort()).toEqual([
      '.gitignore',
      'README.md',
      'manifest.json',
      'package.json',
      'scripts/dev.mjs',
      'scripts/pack.mjs',
      'src/main.test.ts',
      'src/main.ts',
      'tsconfig.json',
      'vite.config.ts',
      'vitest.config.ts',
    ]);
    const manifest = pluginManifestSchema.parse(JSON.parse(template.files['manifest.json']));
    expect(manifest.apiVersion).toBe(PLUGIN_API_VERSION);
  });
});

describe('scaffold', () => {
  it('replaces the ID, name and author everywhere', () => {
    const files = scaffold({ id: 'focus-music', name: 'Focus music', author: 'Ada Lovelace' });
    const manifest = pluginManifestSchema.parse(JSON.parse(files['manifest.json'] ?? ''));
    expect(manifest).toMatchObject({
      id: 'focus-music',
      name: 'Focus music',
      author: 'Ada Lovelace',
    });
    expect(JSON.parse(files['package.json'] ?? '').name).toBe('focus-music');
    expect(files['README.md']).toContain('# Focus music');
    expect(files['README.md']).toContain('focus-music-0.1.0.zip');
    expect(files['src/main.ts']).toContain('Hello from Focus music');
    const all = Object.values(files).join('\n');
    expect(all).not.toContain(TEMPLATE_VALUES.id);
    expect(all).not.toContain(TEMPLATE_VALUES.name);
  });

  it('derives IDs and names from folder names', () => {
    expect(toPluginId('My Cool Plugin')).toBe('my-cool-plugin');
    expect(toPluginId('  Café Crème!! ')).toBe('cafe-creme');
    expect(toPluginId('com.example.Timer')).toBe('com.example.timer');
    expect(toPluginName('word-count')).toBe('Word count');
    expect(toPluginName('com.example.timer')).toBe('Com example timer');
  });

  it('refuses invalid options', () => {
    expect(validateOptions({ id: 'X', name: 'A', author: 'B' })).toMatch(/can't be a plugin ID/);
    expect(validateOptions({ id: 'ok', name: '', author: 'B' })).toMatch(/name/);
    expect(validateOptions({ id: 'ok', name: 'Say "hi"', author: 'B' })).toMatch(/quotes/);
    expect(() => scaffold({ id: 'Bad ID', name: 'x', author: 'y' })).toThrow();
  });
});

describe('a scaffolded project', () => {
  it('builds into a single-file plugin next to its manifest', async () => {
    // Inside the repository (git-ignored), so the project's vite.config.ts resolves `vite`.
    const parent = fileURLToPath(new URL('../node_modules/.tmp/', import.meta.url));
    mkdirSync(parent, { recursive: true });
    const folder = join(mkdtempSync(parent), 'hello');
    folders.push(dirname(folder));
    expect(run([folder], { log: () => undefined, author: () => 'Ada' })).toBe(0);
    const { build } = await import('vite');
    await build({
      root: folder,
      configFile: join(folder, 'vite.config.ts'),
      logLevel: 'silent',
      // Outside this repository the SDK comes from npm; here it is the workspace source.
      resolve: {
        alias: {
          '@tessera/plugin-api': fileURLToPath(
            new URL('../../plugin-api/src/index.ts', import.meta.url),
          ),
        },
      },
    });
    const dist = readdirSync(join(folder, 'dist')).sort();
    expect(dist).toEqual(['README.md', 'main.js', 'manifest.json']);
    const code = readFileSync(join(folder, 'dist', 'main.js'), 'utf8');
    expect(code).toMatch(/export\s*\{[^}]*as default/);
    expect(code).not.toMatch(/\bimport\s*\(|from\s*["']@tessera/);
    expect(JSON.parse(readFileSync(join(folder, 'dist', 'manifest.json'), 'utf8')).id).toBe(
      'hello',
    );
  }, 60_000);
});

describe('the CLI', () => {
  it('creates a project in a new folder and explains what to do next', () => {
    const cwd = tempFolder();
    const lines: string[] = [];
    const code = run(['Focus Music'], {
      cwd,
      log: (line) => lines.push(line),
      author: () => 'Grace',
    });
    expect(code).toBe(0);
    expect(readdirSync(join(cwd, 'Focus Music')).sort()).toContain('manifest.json');
    const manifest = JSON.parse(readFileSync(join(cwd, 'Focus Music', 'manifest.json'), 'utf8'));
    expect(manifest).toMatchObject({ id: 'focus-music', name: 'Focus music', author: 'Grace' });
    expect(lines.join('\n')).toMatch(/Created Focus music \(focus-music\)[\s\S]*pnpm dev/);
  });

  it('takes the ID, name and author from options', () => {
    const cwd = tempFolder();
    expect(
      run(['timer', '--id', 'com.example.timer', '--name', 'Timer', '--author', 'Me'], {
        cwd,
        log: () => undefined,
      }),
    ).toBe(0);
    expect(JSON.parse(readFileSync(join(cwd, 'timer', 'manifest.json'), 'utf8'))).toMatchObject({
      id: 'com.example.timer',
      name: 'Timer',
      author: 'Me',
    });
  });

  it('refuses a folder that is not empty, and prints usage without a folder', () => {
    const cwd = tempFolder();
    writeFileSync(join(cwd, 'keep.txt'), 'mine');
    const lines: string[] = [];
    expect(run(['.'], { cwd, log: (line) => lines.push(line), author: () => null })).toBe(1);
    expect(lines.join('\n')).toMatch(/isn't empty/);
    expect(readdirSync(cwd)).toEqual(['keep.txt']);
    const usage: string[] = [];
    expect(run([], { cwd, log: (line) => usage.push(line) })).toBe(1);
    expect(usage.join('\n')).toMatch(/Usage:/);
    expect(run(['--help'], { cwd, log: () => undefined })).toBe(0);
    expect(run(['x', '--wat'], { cwd, log: () => undefined })).toBe(1);
  });
});
