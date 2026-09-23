/**
 * @tessera/plugins — the plugin host (Agent 06).
 *
 * - `@tessera/plugins/entry`: what the feature registers statically (light).
 * - `@tessera/plugins/host`: the host itself, loaded when a workspace opens.
 * - `@tessera/plugins/i18n`: the `plugins:` strings.
 *
 * This root entry exports the pieces that are useful to tools and tests: bundle reading, the
 * registry format, the manager and the protocol limits.
 */
export * from './constants';
export {
  bundleFromFiles,
  bundleFromUrl,
  bundleFromZip,
  hashBundle,
  normalizeBundlePath,
  PluginBundleError,
  type BundleFile,
  type PluginBundle,
} from './bundle';
export { compareVersions, describePermission, parsePluginManifest } from './manifest';
export {
  fetchRegistry,
  parseRegistry,
  registryEntrySchema,
  searchRegistry,
  type Registry,
  type RegistryEntry,
} from './registry';
export { PluginManager, type InstallPlan, type PluginChange } from './manager';
export { MemoryPluginStore } from './store/memory-store';
export { IndexedDbPluginStore } from './store/idb-store';
export type { InstalledPlugin, PluginSource, PluginStore } from './store/types';
