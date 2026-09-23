/**
 * Static analysis of a Vite build (`apps/web/dist`): the import graph between chunks, the
 * startup set (what the browser must load before the app can render) and the cost of every
 * lazy chunk. Sizes are raw bytes and gzip at zlib's default level, in kB (1,000 bytes). Vite 8's
 * build log computes gzip natively in Rolldown and shows about 1% more for the same file.
 *
 * Startup = the entry chunk + its static imports, plus the chunks of "boot modules": dynamic
 * imports the app always awaits before its first render (the feature registrations in
 * `apps/web/src/main.tsx`), with their static imports.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { parseAst } from 'vite';

export interface ChunkImports {
  static: string[];
  dynamic: string[];
  /** `import(expression)` calls whose target isn't a string (for example locale files). */
  computedDynamic: number;
}

interface AstNode {
  type: string;
  source?: AstNode | null;
  value?: unknown;
  quasis?: Array<{ value: { cooked?: string | null } }>;
  expressions?: unknown[];
  [key: string]: unknown;
}

function literalValue(node: AstNode | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) {
    return node.quasis?.map((quasi) => quasi.value.cooked ?? '').join('') ?? null;
  }
  return null;
}

/** The import specifiers of one chunk (relative, as written: `./chunk-abc.js`). */
export function parseChunkImports(code: string): ChunkImports {
  const result: ChunkImports = { static: [], dynamic: [], computedDynamic: 0 };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const node = value as AstNode;
    if (typeof node.type === 'string') {
      if (
        (node.type === 'ImportDeclaration' ||
          node.type === 'ExportAllDeclaration' ||
          node.type === 'ExportNamedDeclaration') &&
        node.source
      ) {
        const source = literalValue(node.source);
        if (source) result.static.push(source);
      } else if (node.type === 'ImportExpression') {
        const source = literalValue(node.source);
        if (source) result.dynamic.push(source);
        else result.computedDynamic += 1;
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      const child = node[key];
      if (typeof child === 'object' && child !== null) visit(child);
    }
  };
  visit(parseAst(code));
  result.static = [...new Set(result.static)];
  result.dynamic = [...new Set(result.dynamic)];
  return result;
}

export interface Chunk {
  /** Path relative to the dist folder, with `/` (`assets/index-abc.js`). */
  file: string;
  raw: number;
  gzip: number;
  imports: ChunkImports;
  /** Source modules (repo-relative, from the sourcemap) in this chunk, largest first. */
  sources: string[];
  /** The module this chunk is named after, when the sourcemap shows it. */
  facade: string | null;
}

export interface BundleGraph {
  distDir: string;
  entries: string[];
  chunks: Map<string, Chunk>;
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

/** Repo-relative source paths from a chunk's sourcemap, largest first; node_modules shortened. */
function readSources(mapFile: string, repoRoot: string): string[] {
  if (!existsSync(mapFile)) return [];
  const map = JSON.parse(readFileSync(mapFile, 'utf8')) as {
    sources?: string[];
    sourcesContent?: Array<string | null>;
    sourceRoot?: string;
  };
  const base = path.resolve(path.dirname(mapFile), map.sourceRoot ?? '');
  const sources = (map.sources ?? []).map((source, index) => {
    const absolute = path.resolve(base, source);
    let relative = toPosix(path.relative(repoRoot, absolute));
    const nodeModules = relative.lastIndexOf('node_modules/');
    if (nodeModules >= 0) relative = relative.slice(nodeModules);
    return { relative, size: map.sourcesContent?.[index]?.length ?? 0 };
  });
  return sources.sort((a, b) => b.size - a.size).map((source) => source.relative);
}

/**
 * The chunk name without its hash: `assets/TrashView-DY7j_c04.js` → `TrashView`. Hashes are 8
 * base64url characters and may contain `-` themselves (`workspace-doc-DO-bIGU3.js`).
 */
export function chunkName(file: string): string {
  const base = path.posix.basename(file).replace(/\.js$/, '');
  return /^(.+)-[A-Za-z0-9_-]{8}$/.exec(base)?.[1] ?? base;
}

/**
 * The module a chunk is named after: for entries the app's `src/main.ts(x)`, otherwise a source
 * with the chunk's name (or an `index` file in a folder of that name), preferring the repo's own
 * code over `node_modules`.
 */
export function findFacade(file: string, sources: string[], isEntry = false): string | null {
  if (isEntry) return sources.find((source) => /(^|\/)src\/main\.tsx?$/.test(source)) ?? null;
  const name = chunkName(file);
  const own = sources.filter((source) => !source.startsWith('node_modules/'));
  const dependencies = sources.filter((source) => source.startsWith('node_modules/'));
  const named = (source: string) => path.posix.parse(source).name === name;
  const indexOf = (source: string) => {
    const parsed = path.posix.parse(source);
    return parsed.name === 'index' && path.posix.basename(parsed.dir) === name;
  };
  return (
    own.find(named) ??
    own.find(indexOf) ??
    dependencies.find(named) ??
    dependencies.find(indexOf) ??
    null
  );
}

/** Reads every JS chunk of a Vite build and the entry scripts of its `index.html`. */
export function readBundle(distDir: string, repoRoot: string): BundleGraph {
  const html = readFileSync(path.join(distDir, 'index.html'), 'utf8');
  const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((match) =>
    (match[1] ?? '').replace(/^\//, ''),
  );
  const chunks = new Map<string, Chunk>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        const file = toPosix(path.relative(distDir, full));
        const code = readFileSync(full);
        const sources = readSources(`${full}.map`, repoRoot);
        chunks.set(file, {
          file,
          raw: code.byteLength,
          gzip: gzipSync(code).byteLength,
          imports: parseChunkImports(code.toString('utf8')),
          sources,
          facade: findFacade(file, sources, entries.includes(file)),
        });
      }
    }
  };
  walk(distDir);
  return { distDir, entries, chunks };
}

/** Resolves an import specifier of `from` to a chunk file (dist-relative), or null for externals. */
export function resolveImport(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.') && !specifier.startsWith('/')) return null;
  const resolved = specifier.startsWith('/')
    ? specifier.slice(1)
    : path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  return resolved;
}

/** Every chunk reachable from `roots` through static imports (including the roots). */
export function staticClosure(graph: BundleGraph, roots: Iterable<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [...roots];
  while (stack.length) {
    const file = stack.pop();
    if (file === undefined || seen.has(file)) continue;
    const chunk = graph.chunks.get(file);
    if (!chunk) continue;
    seen.add(file);
    for (const specifier of chunk.imports.static) {
      const target = resolveImport(file, specifier);
      if (target && !seen.has(target)) stack.push(target);
    }
  }
  return seen;
}

export interface StartupFile {
  file: string;
  raw: number;
  gzip: number;
  /** Why it is in the startup set. */
  reason: 'entry' | 'static import' | 'boot module';
  facade: string | null;
}

export interface LazyChunk {
  file: string;
  facade: string | null;
  /** Largest source module, when there is no facade. */
  mainSource: string | null;
  /** What loading it adds on top of the startup set (the chunk and its static imports). */
  addedRaw: number;
  addedGzip: number;
}

export interface BundleAnalysis {
  startup: StartupFile[];
  startupRaw: number;
  startupGzip: number;
  /** Boot modules that matched no chunk (the report warns: the budget would miss them). */
  missingBootModules: string[];
  lazy: LazyChunk[];
  /** Total of all JS chunks. */
  totalRaw: number;
  totalGzip: number;
  computedDynamicImports: number;
}

/** Computes the startup set and the lazy chunks. */
export function analyzeBundle(graph: BundleGraph, bootModules: readonly string[]): BundleAnalysis {
  const entryClosure = staticClosure(graph, graph.entries);
  const bootRoots: string[] = [];
  const missingBootModules: string[] = [];
  for (const module of bootModules) {
    const chunk = [...graph.chunks.values()].find((candidate) =>
      candidate.sources.includes(module),
    );
    if (chunk) bootRoots.push(chunk.file);
    else missingBootModules.push(module);
  }
  const bootClosure = staticClosure(graph, bootRoots);
  const startupSet = new Set([...entryClosure, ...bootClosure]);
  const startup: StartupFile[] = [...startupSet]
    .map((file) => {
      const chunk = graph.chunks.get(file);
      if (!chunk) throw new Error(`Missing chunk ${file}`);
      const reason: StartupFile['reason'] = graph.entries.includes(file)
        ? 'entry'
        : entryClosure.has(file)
          ? 'static import'
          : 'boot module';
      return { file, raw: chunk.raw, gzip: chunk.gzip, reason, facade: chunk.facade };
    })
    .sort((a, b) => b.gzip - a.gzip);

  const dynamicTargets = new Set<string>();
  let computedDynamicImports = 0;
  for (const chunk of graph.chunks.values()) {
    computedDynamicImports += chunk.imports.computedDynamic;
    for (const specifier of chunk.imports.dynamic) {
      const target = resolveImport(chunk.file, specifier);
      if (target && graph.chunks.has(target) && !startupSet.has(target)) dynamicTargets.add(target);
    }
  }
  const lazy: LazyChunk[] = [...dynamicTargets]
    .map((file) => {
      const added = [...staticClosure(graph, [file])].filter((item) => !startupSet.has(item));
      const chunk = graph.chunks.get(file);
      return {
        file,
        facade: chunk?.facade ?? null,
        mainSource: chunk?.sources[0] ?? null,
        addedRaw: added.reduce((sum, item) => sum + (graph.chunks.get(item)?.raw ?? 0), 0),
        addedGzip: added.reduce((sum, item) => sum + (graph.chunks.get(item)?.gzip ?? 0), 0),
      };
    })
    .sort((a, b) => b.addedGzip - a.addedGzip);

  const all = [...graph.chunks.values()];
  return {
    startup,
    startupRaw: startup.reduce((sum, file) => sum + file.raw, 0),
    startupGzip: startup.reduce((sum, file) => sum + file.gzip, 0),
    missingBootModules,
    lazy,
    totalRaw: all.reduce((sum, chunk) => sum + chunk.raw, 0),
    totalGzip: all.reduce((sum, chunk) => sum + chunk.gzip, 0),
    computedDynamicImports,
  };
}

/** `215.0 kB` (1 kB = 1,000 bytes, like Vite). */
export function formatKB(bytes: number): string {
  return `${(bytes / 1000).toFixed(1)} kB`;
}
