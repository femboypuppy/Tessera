/** `@tessera/sync/client`: the typed client of the Tessera server's HTTP API. */
export { ServerApi, ServerApiError, type AuthMode, type ServerApiOptions } from './api';
export {
  authModeFor,
  credentialStore,
  IndexedDbCredentialStore,
  MemoryCredentialStore,
  serverApi,
  setCredentialStore,
  type CredentialStore,
} from './connection';
export { displayServerUrl, normalizeServerUrl, syncSocketUrl } from './server-url';
export type * from './schemas';
