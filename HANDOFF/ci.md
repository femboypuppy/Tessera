# CI & quality handoff

## Plan

Milestones from `agents/09-ci-quality.md`, each ending tested and committed on `feat/ci`.

1. **M1: CI workflows** (`.github/workflows`). `ci.yml` (path filter, lint, actionlint, typecheck,
   unit tests with coverage summary, build with the bundle budget, Playwright e2e on Chromium and
   Firefox in shards with blob reports merged into one HTML report, commit-message lint, a
   non-blocking `pnpm audit`, one aggregate `ci` check), `desktop.yml`, `docker.yml`, `docs.yml`,
   `release.yml` (changelog from Conventional Commits, draft release, desktop binaries, Docker
   tags, SHA-256 checksums), `codeql.yml`, `labeler.yml` (+ `.github/labeler.yml`),
   `dependabot.yml`. Every action pinned to a commit SHA with a version comment, least-privilege
   `permissions` per job. Verified with `actionlint` (+ shellcheck) and a unit test that checks
   pinning and permissions. A local runner (`scripts/ci/local.ts`) executes each `ci.yml` job's
   `run:` steps, because `act` is not installed here.
2. **M2: `packages/testkit`.** A deterministic, seeded workspace generator (bundled word lists,
   random nesting, power-law links, tags, tasks, tables, databases with every property type and
   every view type) producing Y.Docs through the core helpers, or a markdown folder with CSV
   databases. Test helpers: in-memory runtime factories (`createTestRuntime`,
   `createSeededAppContext`), a generator-backed `DocStore`, React render helpers with every
   provider, Playwright fixtures (fresh workspace, seeded workspace through a harness app, two users
   through a local server) and an axe helper.
3. **M3: journeys, performance, accessibility.** `e2e/journeys/*` (onboarding → pages → links →
   search → database → import → export → offline → collaboration), each declaring the features it
   needs and skipping with a clear message until they are merged. `scripts/bench` (cold start with
   5,000 pages, opening a 2,000-block page, typing latency, search p95, graph render, importing
   2,000 files) in a real browser against the real shell, printing a markdown table and writing
   JSON; `bench.yml` on `main` and as non-blocking PR comparisons. The bundle report
   (`scripts/bundle`): startup JS against the 250 KB gzip budget (fails CI) plus JS per route.
   axe-core checks on the main screens (`e2e/ci`). Lighthouse CI with scores in the job summary.
4. **M4: hygiene.** Commit-message linting (hook + CI) and a lint-staged pre-commit hook in
   `scripts/git-hooks`, `CODEOWNERS`, `SECURITY.md`, `.github/FUNDING.yml` (commented out).
5. Screenshots of the seeded workspace, this file complete, completion audit.

## Built (what exists and where)

(in progress)

## How it plugs in (FeatureModule entries, services, extension points used)

(in progress)

## Decisions (and why)

(in progress)

## Contract change requests (exact proposed diff to packages/core, and why)

(in progress)

## Known gaps and bugs

(in progress)

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

(in progress)

## Screenshots (list of files)

(in progress)
