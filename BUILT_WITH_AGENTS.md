# How Tessera was built with ten parallel AI agents

Tessera's first version was built by [Claude Code](https://claude.com/claude-code) agents working
from written briefs, with a human owner deciding what to build, reviewing the results and making
the calls. This page describes the process honestly: what the agents did, how they coordinated,
and what that means for the code you're reading.

It's optional reading. The owner decides whether to link it from the README.

> [!NOTE]
> This write-up was drafted by the docs agent (Agent 10) *during* the parallel phase, before the
> branches were merged. It describes the process as designed and as experienced from one agent's
> seat. The merge and polish phases add their own notes in `HANDOFF/integration.md` and
> `HANDOFF/polish.md`.

## The setup

Twelve briefs live in [`agents/`](agents). Each one is a detailed assignment: what the area
owns, milestones in order, acceptance criteria, pitfalls, and the screenshots to deliver.

| Phase        | Agents     | What happened                                                        |
| ------------ | ---------- | -------------------------------------------------------------------- |
| 1. Architect | 01         | Alone, on `main`: the monorepo, the contracts in `packages/core`, the design system in `packages/ui`, the app shell, `SPEC.md` and notes for every other agent. |
| 2. Parallel  | 02–10      | Nine agents at the same time, each in its own git worktree and branch: editor, sync and server, databases, search and graph, plugins, desktop and self-hosting, markdown and import, CI and quality, docs and launch. |
| 3. Merge     | 11         | The architect again: apply contract change requests, merge the nine branches one at a time, keep `main` green, wire the cross-feature flows. |
| 4. Polish    | 12         | A final pass as a first-time user: fix rough edges, check performance budgets, record the demo, prepare the release. |

## How agents that can't talk to each other coordinate

The nine parallel agents had no way to message each other. Everything they shared was written
down:

- **Contracts in code.** `packages/core` defines every type, the document schema, the service
  interfaces and the extension points, with an in-memory stub for every service. An agent that
  needed another agent's work coded against the interface and used the stub; the real
  implementation replaced it at merge time.
- **Ownership by folder.** Each agent could only create and edit files in the folders it owned
  (the table is in [`CLAUDE.md`](CLAUDE.md)). No two agents edit the same file, which keeps merge
  conflicts down to shared generated files like the lockfile.
- **Plug in, don't patch.** The app shell loads each feature through one registration file
  (`apps/web/src/features/<area>/index.ts`). Features add routes, panels, commands and services
  there instead of editing the shell.
- **Handoff files.** Each agent kept a notebook in `HANDOFF/<area>.md`: its plan, decisions,
  known gaps, and *contract change requests*, exact diffs to `packages/core` that only the
  architect could apply, at merge time.
- **Shared rules.** [`CLAUDE.md`](CLAUDE.md) sets the engineering standards every agent followed:
  strict TypeScript, real tests, no placeholder code, accessibility, `t()` for every string,
  security rules.

## Why it's built the way it is

Some of Tessera's architecture exists because of this process, and turned out to be good design
anyway:

- **Service priorities** (in-memory stubs, browser, desktop) let nine features develop against
  stubs and made the same app run in browsers, Tauri and tests.
- **One canonical document schema** with a conformance test kept the editor, the markdown codec
  and the search indexer compatible, although they were written by three different agents.
- **Thin feature modules and lazy loading** made independent work possible and keep the startup
  bundle small.

## What a human did

The owner commissioned and revised the briefs, reviewed the output, and made the product
decisions (the name, the license, what's in 0.1).
Agents were told not to ask the human questions during the parallel phase: they recorded their
decisions and reasons in their handoff files instead, for review at merge time.

## Seen from the docs agent's seat

- **Writing docs for software that doesn't exist yet** is the strangest part. The docs agent
  worked from the briefs and `SPEC.md` while the features were being built on other branches, so
  every guide describes the specified behavior. Details that could change (default values,
  exact file names of release downloads) are marked in the docs and listed in
  `HANDOFF/docs.md` for the merge to verify.
- **Screenshots by contract.** The README references screenshots by the exact names in each
  agent's brief. A test checks that every image path either exists or is one another agent has
  promised, so broken images are caught at merge time instead of on launch day.
- **Honesty is enforced by checks, not intentions.** The comparison table was checked against
  each product's current docs and dated; the demo workspace's facts were checked; tests verify
  that every wikilink in the demo resolves and every issue form is valid.

## What this means for contributors

- The code follows one set of conventions, documented in [CONTRIBUTING.md](CONTRIBUTING.md).
  You don't need to know how it was written to work on it.
- `SPEC.md` and the handoff files are an unusually complete record of *why* things are the way
  they are. Read them before a big change.
- AI-written code gets the same review as any other code. If something looks wrong, it may well
  be: please open an issue.

## Reproducing it

Everything needed is in the repository: the briefs in [`agents/`](agents), the shared rules in
[`CLAUDE.md`](CLAUDE.md), the contract in [`SPEC.md`](SPEC.md), and `agents/RUN_GUIDE.md` with
`agents/setup-worktrees.sh` for creating the worktrees.
