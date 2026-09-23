/**
 * Playwright helpers: fixtures (fresh, seeded and collaborative workspaces), shell helpers,
 * feature detection for journeys, axe checks, and the harness and server launchers.
 */
export { TesseraApp } from './app';
export {
  formatViolations,
  scanAccessibility,
  type AxeViolation,
  type Impact,
  type ScanOptions,
} from './axe';
export {
  describeMissing,
  FEATURE_CHECKS,
  missingFeatures,
  readDiagnostics,
  type Diagnostics,
  type FeatureName,
} from './features';
export {
  expect,
  test,
  type Collaborators,
  type SeededState,
  type SeededWorkspace,
  type TesseraFixtures,
  type TesseraWorkerFixtures,
} from './fixtures';
export { harnessSearch, startHarness, type HarnessServer } from './harness-server';
export { freePort, startSyncServer, type SyncServer } from './sync-server';
