import type { ServerConfig } from '../config';

/** Origins of the Tauri desktop app's webview on each platform. */
export const DESKTOP_ORIGINS = [
  'tauri://localhost',
  'http://tauri.localhost',
  'https://tauri.localhost',
];

/**
 * Which browser origins may use the API with credentials and open cookie-authenticated
 * WebSockets: the server's own origin (it serves the web app), `PUBLIC_URL`, `CORS_ORIGINS` and
 * the desktop app.
 */
export function createOriginPolicy(
  config: Pick<ServerConfig, 'publicUrl' | 'corsOrigins' | 'trustProxy'>,
) {
  const allowed = new Set<string>([...DESKTOP_ORIGINS, ...config.corsOrigins]);
  if (config.publicUrl) allowed.add(config.publicUrl);
  return {
    /** Whether `origin` may call the API with credentials. `host` is the request's Host header. */
    isAllowed(origin: string, host: string | null, forwardedProto?: string | null): boolean {
      if (allowed.has(origin)) return true;
      if (!host) return false;
      // Same origin as the request: the web app served by this server.
      try {
        const url = new URL(origin);
        if (url.host !== host) return false;
        if (config.trustProxy && forwardedProto) return url.protocol === `${forwardedProto}:`;
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    },
    list(): string[] {
      return [...allowed];
    },
  };
}

export type OriginPolicy = ReturnType<typeof createOriginPolicy>;
