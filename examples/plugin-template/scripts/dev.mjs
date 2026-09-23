// Development server: rebuilds the plugin on every save and serves dist/ for Tessera's dev mode
// (Settings → Plugins → Install plugin → Load a dev plugin), which reloads the plugin when it
// changes.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { build } from 'vite';

const port = Number(process.env.PORT ?? 5199);
const dist = new URL('../dist/', import.meta.url);
const types = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

// Tessera fetches the plugin from its own origin, so the server allows cross-origin reads (and
// private-network access for https pages talking to localhost). Nothing is cached.
const headers = {
  'access-control-allow-origin': '*',
  'access-control-allow-private-network': 'true',
  'cache-control': 'no-store',
};

createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    response.writeHead(204, {
      ...headers,
      'access-control-allow-methods': 'GET',
      'access-control-allow-headers': '*',
    });
    response.end();
    return;
  }
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname).replace(
    /^\/+/,
    '',
  );
  if (path.split('/').includes('..')) {
    response.writeHead(403, headers).end();
    return;
  }
  try {
    const body = await readFile(new URL(path || 'manifest.json', dist));
    response.writeHead(200, {
      ...headers,
      'content-type': types[extname(path || '.json')] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404, headers).end();
  }
}).listen(port, () => {
  console.info(`\nServing dist/ at http://localhost:${port}/`);
  console.info('In Tessera: Settings → Plugins → Install plugin → Load a dev plugin.\n');
});

await build({ build: { watch: {} } });
