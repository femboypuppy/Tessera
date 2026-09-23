# Agent 09 — CI, testing infrastructure & quality

**Parallel phase, branch `feat/ci`. Effort: xhigh.**

You own `.github/workflows`, `.github/dependabot.yml`, `.github/CODEOWNERS`, `.github/labeler.yml`, `packages/testkit`, `scripts/`, `e2e/journeys`, `e2e/support`, `SECURITY.md`, and your HANDOFF folder.

## Why this matters

Green checks, reproducible releases and published benchmarks make a repo look trustworthy enough to star, use and contribute to. You also build the test tools the merge phase needs to prove everything works together.

## Read first

`CLAUDE.md`, `SPEC.md` (especially the budgets), `HANDOFF/architect.md`, the root scripts, the Vitest and Playwright configs, and `packages/core`.

## M1 — CI workflows

- `ci.yml` on pull requests and pushes to `main`:
  - pnpm install with caching, lint, typecheck, unit tests with coverage (uploaded as an artifact and summarized in the job summary), and a build of everything
  - Playwright e2e on Chromium and Firefox, sharded, with traces and screenshots uploaded on failure
  - `concurrency` with cancel-in-progress; target under 10 minutes with caching
- `desktop.yml`: Tauri builds for macOS (arm64 and x64), Windows and Linux on tags and manual dispatch.
- `docker.yml`: a multi-arch image build pushed to GHCR on tags, with build caching.
- `docs.yml`: build the VitePress docs and deploy them to GitHub Pages on `main`.
- `release.yml`: on `v*` tags, generate a changelog from Conventional Commits, create a GitHub Release with the desktop binaries and checksums, and tag the Docker images.
- `codeql.yml`; `dependabot.yml` (npm weekly and grouped, GitHub Actions monthly, cargo weekly); `labeler.yml` labeling PRs by path. No stale bot; those annoy contributors.
- Pin third-party actions to commit SHAs with version comments, and give each job only the `permissions` it needs.

## M2 — `packages/testkit`

- A deterministic, seeded workspace generator: N pages with realistic titles and text (from a bundled word list, no network), random nesting, links with a power-law distribution (so graphs look real), tags, tasks, tables, and databases with rows for every property type. It outputs Y.Docs through the core helpers, or a markdown folder.
- Test helpers: an in-memory runtime factory, React render helpers with all the providers, and Playwright fixtures (a fresh workspace, a seeded workspace, and two users collaborating through a local server).

## M3 — Journeys, performance and accessibility

- `e2e/journeys/`: end-to-end user journeys across features: onboarding → create pages → link → search → database → import → export → offline and back online → collaboration. They'll fail until the merge, so each one skips cleanly with a clear message when a feature isn't registered, keeping `main` green.
- `scripts/bench`: a benchmark suite (cold start with 5,000 pages, opening a 2,000-block page, typing latency, search p95, graph render, importing 2,000 files) that prints a markdown table and writes JSON. `bench.yml` runs it on `main` and posts non-blocking comparisons on PRs.
- A bundle-size report per route, checked against the budgets in `SPEC.md` (CI fails above budget).
- Accessibility checks with axe-core in Playwright on the main screens (fail on serious and critical issues).
- Lighthouse CI for the web app, with scores in the PR summary.

## M4 — Repository hygiene

- Commit-message linting and a fast pre-commit hook (lint-staged on changed files only; keep it under a few seconds so contributors don't disable it).
- `CODEOWNERS`, `SECURITY.md` (how to report vulnerabilities privately), and `.github/FUNDING.yml` as a commented-out placeholder.

## Acceptance criteria

- Every workflow passes `actionlint`. The `ci.yml` logic runs green locally (with `act` if available, otherwise by running each step's commands).
- The testkit generator is deterministic (same seed, identical output), and tested.
- The journeys skip cleanly when features are missing and are ready to run after the merge.
- `scripts/bench` runs locally and prints its table; the bundle-size and axe checks run.
- HANDOFF lists every workflow, what triggers it, and every secret or setting the owner must configure (GHCR permissions, Pages, signing keys).

## Pitfalls

- Don't let CI get slow: cache aggressively, shard e2e, and run expensive jobs only when relevant paths change.
- Journeys must never be flaky. Use proper waits, never fixed sleeps.
