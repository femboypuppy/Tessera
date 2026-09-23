const PRIVATE_HOST =
  /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)(:\d+)?$/i;

/**
 * Turns what someone typed into a server URL: `notes.example.com` → `https://notes.example.com`,
 * `localhost:8787` → `http://localhost:8787`, trailing slashes removed. Null when it isn't one.
 */
export function normalizeServerUrl(input: string): string | null {
  let value = input.trim();
  if (!value) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) {
    const host = value.split('/')[0] ?? '';
    const local = PRIVATE_HOST.test(host) || /\.local(:\d+)?$/i.test(host);
    value = `${local ? 'http' : 'https'}://${value}`;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!url.hostname) return null;
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

/** The WebSocket endpoint of a server (`wss://host/sync`). */
export function syncSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/+$/, '')}/sync`;
  url.search = '';
  url.hash = '';
  return url.toString();
}

/** The address shown to people: host and path without the scheme. */
export function displayServerUrl(serverUrl: string): string {
  return serverUrl.replace(/^https?:\/\//, '');
}
