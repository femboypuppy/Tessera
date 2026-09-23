/**
 * @tessera/testkit: test tooling for every package (Agent 09).
 *
 * - `@tessera/testkit` / `/generator`: the seeded workspace generator.
 * - `@tessera/testkit/runtime`: in-memory and seeded runtimes and sessions.
 * - `@tessera/testkit/react`: render helpers with every provider (jsdom tests).
 * - `@tessera/testkit/playwright`: Playwright fixtures and helpers (end-to-end tests).
 * - `@tessera/testkit/ci`: the workflow tooling behind `scripts/`.
 *
 * The seeded harness app lives in `harness/` (`pnpm --filter @tessera/testkit harness`).
 */
export * from './generator';
export * from './runtime';
export type { HarnessPage, HarnessState } from './harness-state';
