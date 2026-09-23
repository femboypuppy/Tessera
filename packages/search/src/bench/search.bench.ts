/**
 * Search benchmark on a generated workspace: initial indexing, persisted startup, query latency
 * and palette keystroke latency (p50/p95), plus link queries. Runs the same `IndexCore` the worker
 * runs. Exits with an error when a query p95 reaches the 50 ms budget (SPEC section 10).
 *
 *   pnpm --filter @tessera/search bench            # 5,000 pages
 *   pnpm --filter @tessera/search bench -- 10000   # another size
 */
import { createDocFromJSON, setPageProps, type JsonValue } from '@tessera/core';
import * as Y from 'yjs';
import { IndexCore } from '../engine/index-core';
import type { PageMetaLite } from '../engine/types';
import { benchmarkQueries, createRandom, generateWorkspace, keystrokes } from './generator';

const BUDGET_MS = 50;
const DAY_MS = 86_400_000;

function percentile(samples: number[], p: number): number {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

function time<T>(fn: () => T): { value: T; ms: number } {
  const start = performance.now();
  const value = fn();
  return { value, ms: performance.now() - start };
}

/** Median of `runs` timings of `fn`: robust against a machine busy with other work. */
function median(fn: () => unknown, runs = 5): number {
  const samples = Array.from({ length: runs }, () => time(fn).ms).sort((a, b) => a - b);
  return samples[Math.floor(runs / 2)] ?? 0;
}

function row(label: string, value: string): void {
  console.log(`${label.padEnd(44)} ${value}`);
}

const size = Number(process.argv[2] ?? 5000);
const now = Date.UTC(2026, 8, 1);
console.log(`Generating ${size} pages…`);
const workspace = generateWorkspace({ pages: size, seed: 42 });
const metas: PageMetaLite[] = workspace.pages.map((page) => ({
  id: page.id,
  title: page.title,
  kind: 'page',
  parentId: page.parentId,
  trashed: false,
  isRow: false,
  icon: page.icon,
  createdAt: now - (page.ageDays + 30) * DAY_MS,
  updatedAt: now - page.ageDays * DAY_MS,
}));
const updates = workspace.pages.map((page) => {
  const doc = createDocFromJSON(page.doc);
  const props: Record<string, JsonValue> = {};
  if (page.tags.length) props.tags = page.tags;
  if (page.aliases.length) props.aliases = page.aliases;
  setPageProps(doc, props);
  const bytes = Y.encodeStateAsUpdate(doc);
  doc.destroy();
  return bytes;
});
const totalBytes = updates.reduce((sum, bytes) => sum + bytes.byteLength, 0);
console.log(`Docs: ${(totalBytes / 1024 / 1024).toFixed(1)} MB of Yjs updates\n`);

// 1. Initial indexing: metadata, then every doc (what the worker does on a first start).
const core = new IndexCore({ now: () => now });
const initial = time(() => {
  core.setMeta(metas, [], true);
  workspace.pages.forEach((page, i) => {
    core.setContentFromBytes(page.id, updates[i] ?? null, metas[i]?.updatedAt ?? 0);
  });
});
row('Initial index (parse + index every doc)', `${initial.ms.toFixed(0)} ms`);
row('  per doc', `${(initial.ms / size).toFixed(2)} ms`);

// 2. Persisted startup: serialize, clone (as IndexedDB would), restore, reconcile metadata.
const persisted = time(() => structuredClone(core.toPersisted()));
row('Persist (serialize + structured clone)', `${persisted.ms.toFixed(0)} ms`);
const restore = time(() => {
  const restored = new IndexCore({ now: () => now, persisted: persisted.value });
  const stale = restored.setMeta(metas, [], true);
  return { restored, stale };
});
row('Persisted startup (load + reconcile)', `${restore.ms.toFixed(0)} ms`);
row('  docs to re-read after restore', String(restore.value.stale.pages.length));
const restored = restore.value.restored;

// 3. Queries: words, prefixes, typos, two words, filters.
const random = createRandom(7);
const queries = benchmarkQueries(random, 300);
for (const query of queries.slice(0, 20))
  restored.query({ text: query, filters: {}, limit: 20, offset: 0 });
const querySamples = queries.map((query) =>
  median(() => restored.query({ text: query, filters: {}, limit: 20, offset: 0 })),
);
row(
  'Query p50 / p95 / max',
  `${percentile(querySamples, 50).toFixed(2)} / ${percentile(querySamples, 95).toFixed(2)} / ${Math.max(...querySamples).toFixed(2)} ms (${queries.length} queries)`,
);

// 4. Palette keystrokes: every prefix of phrases typed one key at a time.
const phrases = [
  'andromeda galaxy',
  'kyoto itinerary',
  'sourdough',
  'transformers paper notes',
  'coral bleaching',
  'apollo program timeline',
  'offline sync spec',
  'deep work',
  'europa',
  'mantis shrimp dive log',
];
const keySamples = phrases.flatMap((phrase) =>
  keystrokes(phrase).map((prefix) =>
    median(() => restored.query({ text: prefix, filters: {}, limit: 12, offset: 0 })),
  ),
);
row(
  'Palette keystroke p50 / p95 / max',
  `${percentile(keySamples, 50).toFixed(2)} / ${percentile(keySamples, 95).toFixed(2)} / ${Math.max(...keySamples).toFixed(2)} ms (${keySamples.length} keystrokes)`,
);

// 5. Filters only and links.
const filterSamples = ['astronomy', 'ocean', 'product', 'books', 'recipes', 'travel', 'ml'].map(
  (tag) =>
    median(() => restored.query({ text: '', filters: { tags: [tag] }, limit: 50, offset: 0 })),
);
row('Filter-only query (tag:) p95', `${percentile(filterSamples, 95).toFixed(2)} ms`);
const ids = workspace.pages.map((page) => page.id);
const backlinkSamples = ids.slice(0, 200).map((id) => median(() => restored.backlinks(id)));
row('Backlinks p95', `${percentile(backlinkSamples, 95).toFixed(2)} ms`);
const mentionSamples = ids.slice(0, 50).map((id) => median(() => restored.mentionCandidates(id)));
row('Unlinked-mention candidates p95', `${percentile(mentionSamples, 95).toFixed(2)} ms`);
const graph = time(() => restored.graph());
row(
  'Graph snapshot',
  `${graph.ms.toFixed(0)} ms (${graph.value.nodes.length} nodes, ${graph.value.edges.length} edges)`,
);

const worst = Math.max(percentile(querySamples, 95), percentile(keySamples, 95));
console.log('\nLatencies are the median of 5 runs of each query.');
console.log(`Budget: p95 < ${BUDGET_MS} ms → ${worst < BUDGET_MS ? 'OK' : 'OVER BUDGET'}`);
if (worst >= BUDGET_MS) process.exitCode = 1;
