import type { PluginManifest } from '@tessera/core';
import { strToU8, zipSync } from 'fflate';
import type { PluginBundle } from '../bundle';

/** A valid manifest for tests. */
export function manifest(patch: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'word-count',
    name: 'Word count',
    version: '1.0.0',
    apiVersion: 1,
    author: 'Tessera',
    description: 'Counts words.',
    entry: 'main.js',
    permissions: ['pages:read', 'ui:panels'],
    ...patch,
  };
}

/** A bundle for tests; `code` is what the in-process sandbox looks up. */
export function bundle(patch: Partial<PluginManifest> = {}, code?: string): PluginBundle {
  const value = manifest(patch);
  return { manifest: value, code: code ?? `plugin:${value.id}@${value.version}` };
}

/** Zips files (strings or bytes) like a plugin archive. */
export function zip(files: Record<string, string | Uint8Array>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const [path, content] of Object.entries(files))
    entries[path] = typeof content === 'string' ? strToU8(content) : content;
  return zipSync(entries);
}

/** A `fetch` that serves a fixed map of URLs. */
export function fakeFetch(
  routes: Record<string, string | Uint8Array | { status: number }>,
): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const impl = async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes[url];
    if (route === undefined) return new Response('Not found', { status: 404 });
    if (typeof route === 'object' && 'status' in route && !(route instanceof Uint8Array))
      return new Response('', { status: route.status });
    return new Response(route as BodyInit, { status: 200 });
  };
  return Object.assign(impl as typeof fetch, { calls });
}
