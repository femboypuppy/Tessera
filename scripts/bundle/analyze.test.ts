import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyzeBundle,
  chunkName,
  findFacade,
  formatKB,
  parseChunkImports,
  readBundle,
} from './analyze.ts';
import { bundleMarkdown, type Budgets } from './report.ts';

describe('parseChunkImports', () => {
  it('finds static imports, re-exports and dynamic imports written with any quotes', () => {
    const imports = parseChunkImports(
      [
        'import{a as b}from"./a-11111111.js";',
        "import './b-22222222.js';",
        'export{c}from"./c-33333333.js";',
        'export*from"./d-44444444.js";',
        'const x=()=>import(`./e-55555555.js`), y=()=>import("./f-66666666.js");',
        'const z=(name)=>import(name); const s="import(\'./not-an-import.js\')";',
        'import{a as again}from"./a-11111111.js";',
      ].join('\n'),
    );
    expect(imports).toEqual({
      static: ['./a-11111111.js', './b-22222222.js', './c-33333333.js', './d-44444444.js'],
      dynamic: ['./e-55555555.js', './f-66666666.js'],
      computedDynamic: 1,
    });
  });
});

describe('chunk names and facades', () => {
  it('strips 8-character hashes, even ones containing a dash', () => {
    expect(chunkName('assets/TrashView-DY7j_c04.js')).toBe('TrashView');
    expect(chunkName('assets/workspace-doc-DO-bIGU3.js')).toBe('workspace-doc');
    expect(chunkName('assets/plain.js')).toBe('plain');
  });

  it('prefers the repo’s own module over a dependency with the same name', () => {
    const sources = [
      'node_modules/@radix-ui/react-select/dist/index.mjs',
      'apps/web/src/features/index.ts',
      'apps/web/src/main.tsx',
    ];
    expect(findFacade('assets/features-AAAAAAAA.js', sources)).toBe(
      'apps/web/src/features/index.ts',
    );
    expect(findFacade('assets/index-AAAAAAAA.js', sources, true)).toBe('apps/web/src/main.tsx');
    expect(findFacade('assets/index-AAAAAAAA.js', ['node_modules/x/index.js'], true)).toBeNull();
    expect(
      findFacade('assets/react-select-AAAAAAAA.js', ['node_modules/react-select/index.js']),
    ).toBe('node_modules/react-select/index.js');
  });
});

describe('analyzeBundle', () => {
  let root = '';
  let dist = '';
  const write = (file: string, code: string, sources?: string[]) => {
    const full = path.join(dist, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, code);
    if (sources) {
      writeFileSync(
        `${full}.map`,
        JSON.stringify({
          version: 3,
          sources,
          sourcesContent: sources.map(() => 'x'),
          mappings: '',
        }),
      );
    }
  };

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'tessera-bundle-'));
    dist = path.join(root, 'apps/web/dist');
    write(
      'index.html',
      '<script src="/theme-init.js"></script><script type="module" crossorigin src="/assets/index-AAAAAAAA.js"></script>',
    );
    write(
      'assets/index-AAAAAAAA.js',
      'import{a}from"./shared-BBBBBBBB.js";const f=()=>import(`./lazy-CCCCCCCC.js`),g=()=>import(`./features-DDDDDDDD.js`),h=(x)=>import(x);export{f,g,h,a};',
      ['../../src/main.tsx'],
    );
    write('assets/shared-BBBBBBBB.js', 'export const a=1;', [
      '../../../../packages/core/src/json.ts',
    ]);
    write(
      'assets/lazy-CCCCCCCC.js',
      'import{a}from"./shared-BBBBBBBB.js";import{b}from"./big-EEEEEEEE.js";export default a+b;',
      ['../../src/app/lazy.tsx'],
    );
    write('assets/big-EEEEEEEE.js', `export const b=${JSON.stringify('lorem '.repeat(2000))};`);
    write(
      'assets/features-DDDDDDDD.js',
      'import{a}from"./shared-BBBBBBBB.js";export const features=[a];',
      ['../../src/features/index.ts'],
    );
  });
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('counts the entry, its static imports and boot modules as startup JS', () => {
    const graph = readBundle(dist, root);
    expect(graph.entries).toEqual(['assets/index-AAAAAAAA.js']);
    const analysis = analyzeBundle(graph, ['apps/web/src/features/index.ts']);
    expect(
      analysis.startup.map((file) => [path.posix.basename(file.file), file.reason, file.facade]),
    ).toEqual(
      expect.arrayContaining([
        ['index-AAAAAAAA.js', 'entry', 'apps/web/src/main.tsx'],
        ['shared-BBBBBBBB.js', 'static import', null],
        ['features-DDDDDDDD.js', 'boot module', 'apps/web/src/features/index.ts'],
      ]),
    );
    expect(analysis.startup).toHaveLength(3);
    expect(analysis.startupGzip).toBe(analysis.startup.reduce((sum, file) => sum + file.gzip, 0));
    expect(analysis.missingBootModules).toEqual([]);
    expect(analysis.computedDynamicImports).toBe(1);
  });

  it('charges each lazy chunk for what it adds beyond the startup set', () => {
    const graph = readBundle(dist, root);
    const analysis = analyzeBundle(graph, ['apps/web/src/features/index.ts']);
    expect(analysis.lazy).toHaveLength(1);
    const [lazy] = analysis.lazy;
    const big = graph.chunks.get('assets/big-EEEEEEEE.js');
    const own = graph.chunks.get('assets/lazy-CCCCCCCC.js');
    expect(lazy?.facade).toBe('apps/web/src/app/lazy.tsx');
    expect(lazy?.addedRaw).toBe((big?.raw ?? 0) + (own?.raw ?? 0));
    expect(lazy?.addedGzip).toBe((big?.gzip ?? 0) + (own?.gzip ?? 0));
  });

  it('reports boot modules it cannot find, and fails the budget in the markdown', () => {
    const analysis = analyzeBundle(readBundle(dist, root), ['apps/web/src/missing.ts']);
    expect(analysis.missingBootModules).toEqual(['apps/web/src/missing.ts']);
    const tight: Budgets = { startup: { maxGzipBytes: 10, bootModules: [] } };
    const markdown = bundleMarkdown(analysis, tight);
    expect(markdown).toContain('❌ **Startup JS:');
    expect(markdown).toContain('Boot modules not found in any chunk: `apps/web/src/missing.ts`');
    const roomy: Budgets = { startup: { maxGzipBytes: 1_000_000, bootModules: [] } };
    expect(bundleMarkdown(analysis, roomy)).toContain('✅ **Startup JS:');
  });
});

describe('formatKB', () => {
  it('uses kB of 1,000 bytes with one decimal', () => {
    expect(formatKB(215_030)).toBe('215.0 kB');
    expect(formatKB(250_000)).toBe('250.0 kB');
    expect(formatKB(440)).toBe('0.4 kB');
  });
});
