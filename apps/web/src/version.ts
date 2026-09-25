declare const __TESSERA_VERSION__: string | undefined;

/**
 * The app's version (`apps/web/package.json`), set by the build (`vite.config.ts` `define`).
 * `dev` where no build defines it (unit tests, the seeded harness).
 */
export const APP_VERSION: string =
  typeof __TESSERA_VERSION__ === 'string' ? __TESSERA_VERSION__ : 'dev';
