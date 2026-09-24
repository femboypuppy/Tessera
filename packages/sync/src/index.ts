/**
 * @tessera/sync — browser persistence and sync (Agent 03).
 *
 * The root entry holds only light registration code: `syncServices` (the IndexedDB stores and
 * the Hocuspocus provider behind dynamic imports). Heavy code lives in subpaths:
 * `@tessera/sync/stores`, `/provider`, `/activate` and `/ui`. See HANDOFF/sync.md.
 */
export { syncServices } from './feature/services';
