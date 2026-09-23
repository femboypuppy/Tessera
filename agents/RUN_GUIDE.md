# Tessera — how to run the 10-agent build

This guide is for you, the human. You'll run 12 prompts in four phases: the Architect alone, nine agents in parallel, the Architect again to merge, then a final polish pass.

## 0. One-time setup

1. Install Git, Node LTS, pnpm, Rust (for the Tauri desktop app) and Docker (for self-hosting tests).
2. Update Claude Code with `claude update`. The `/goal` command used below needs a recent version.
3. Create an empty GitHub repo. Check that the name isn't taken; if you pick another name, find-and-replace "Tessera" / "tessera" in these files first.
4. Clone it and unzip this pack into the repo root. You should see `CLAUDE.md` and an `agents/` folder.
5. Commit and push:

   ```bash
   git add -A && git commit -m "chore: add agent prompts" && git push
   ```

## Two Claude Code features that make long unattended runs work

- **`/goal <condition>`**: Claude keeps working turn after turn until a separate model confirms the condition is met, so an agent doesn't stop after one turn to report back. Every agent ends with a *Completion audit* message that the goal checker can read.
- **Auto mode**: a permission mode where background safety checks replace approval prompts, so agents aren't stuck waiting on you. Shift+Tab cycles permission modes. If auto mode isn't available to you, use accept-edits mode; the Architect's `.claude/settings.json` also pre-approves common safe commands.

Don't use `--dangerously-skip-permissions` outside a disposable VM or container.

## Phase 1 — Architect (alone)

In the repo folder:

```
claude
/effort max
/goal Agent 01 is done: every acceptance criterion in agents/01-architect.md holds and all work is committed to main, proven by a final "Completion audit" message showing passing pnpm typecheck, lint, test and test:e2e output. Start by reading CLAUDE.md and agents/01-architect.md, then execute agents/01-architect.md completely.
```

When it finishes, run `pnpm dev` yourself and skim `SPEC.md`. If anything looks wrong, tell the Architect now. Fixing contracts later is expensive.

## Phase 2 — Nine agents in parallel

```bash
bash agents/setup-worktrees.sh
```

This creates `../<repo>-editor`, `../<repo>-sync` and so on, each on its own `feat/*` branch with dependencies installed.

Open nine terminals (tmux panes or terminal tabs; name each one after its agent). In each:

```
cd ../<repo>-<area>
claude
/effort xhigh
/goal Agent NN is done: every acceptance criterion in agents/<file> holds and the Definition of done in CLAUDE.md is met, proven by a final "Completion audit" message showing passing pnpm typecheck, lint and test output. Start by reading CLAUDE.md, SPEC.md, HANDOFF/architect.md and agents/<file>, then execute it completely.
```

| Folder | NN | `<file>` | Effort |
|---|---|---|---|
| `<repo>-editor` | 02 | `02-editor.md` | xhigh |
| `<repo>-sync` | 03 | `03-sync.md` | xhigh |
| `<repo>-databases` | 04 | `04-databases.md` | xhigh |
| `<repo>-search` | 05 | `05-search-graph.md` | xhigh |
| `<repo>-plugins` | 06 | `06-plugins.md` | xhigh |
| `<repo>-desktop` | 07 | `07-desktop-selfhost.md` | xhigh |
| `<repo>-importers` | 08 | `08-importers.md` | xhigh |
| `<repo>-ci` | 09 | `09-ci-quality.md` | xhigh |
| `<repo>-docs` | 10 | `10-docs-launch.md` | high |

Tips:

- **Check in now and then.** If an agent drifts outside its folders, tell it to reread the ownership table in `CLAUDE.md`.
- **If you hit a usage limit**, resume later with `claude --continue` in that folder. A goal that was still active comes back with the session.
- **Auto memory is shared by all worktrees of one repo.** `CLAUDE.md` tells agents not to store role-specific notes there, but if an agent seems confused about its role, check that first.
- **Don't use ultracode for these nine.** Each agent would spawn its own sub-agents on top of your nine, which burns usage fast and makes merging messier.

## Phase 3 — Merge

When all nine are done, go back to the main repo folder:

```
claude
/effort max
/goal Agent 11 is done: every acceptance criterion in agents/11-merge.md holds, proven by a final "Completion audit" message. Start by reading CLAUDE.md and agents/11-merge.md, then execute it completely.
```

Then push `main` and remove the worktrees with `git worktree remove ../<repo>-<area>` for each folder (the branches stay).

## Phase 4 — Polish (fresh session)

```
claude
/effort xhigh
/goal Agent 12 is done: every acceptance criterion in agents/12-polish.md holds, proven by a final "Completion audit" message. Start by reading CLAUDE.md and agents/12-polish.md, then execute it completely.
```

## Phase 5 — Launch (you)

1. Read the README top to bottom yourself and try the quickstart on a clean machine.
2. In GitHub settings, add the description, website link, topics (`local-first`, `notion-alternative`, `obsidian`, `knowledge-base`, `self-hosted`, `note-taking`, `markdown`, `crdt`, `yjs`, `tauri`) and the social preview image. Turn on Discussions and pin a welcome post.
3. File the issues from `ISSUES_TO_FILE.md` and label the small ones `good first issue`.
4. Tag `v0.1.0` and push the tag. The release workflow builds the binaries and the Docker image.
5. Post using `LAUNCH.md` (Show HN, r/selfhosted, r/opensource and so on) and reply to every comment for the first few hours.

Stars have to be earned: bought stars and star-for-star swaps break GitHub's rules and get repos flagged. A great first five minutes is what actually gets you stars.

## Simpler alternative (less control)

One session instead of twelve:

```
/effort ultracode
Read CLAUDE.md and every file in agents/ in numeric order, then build the whole project, following them as closely as one orchestrated session can.
```
