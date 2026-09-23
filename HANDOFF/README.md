# HANDOFF

This folder is how the agents talk to each other. Nine agents work in parallel on separate
branches and can't see each other's sessions, so everything another agent (or the merge) needs to
know goes in a file here.

## Files

| File | Owner | What it holds |
|---|---|---|
| `README.md` | Architect | This guide. |
| `architect.md` | Agent 01 | What the skeleton provides, the decisions behind the contracts, and **Notes for each agent**. Read it before you start. |
| `editor.md`, `sync.md`, `databases.md`, `search.md`, `plugins.md`, `desktop.md`, `importers.md`, `ci.md`, `docs.md` | Agents 02–10 | Each agent's notebook and final report. Create yours when you start. |
| `integration.md` | Architect, at merge time | The merge plan, every contract change request with its verdict, and every follow-up. |

Only edit your own file. Reading every file is fine and encouraged.

## Template

Start your file with your plan and keep it current as you work. When you finish, every section is
filled in (write "None" rather than deleting a section).

```markdown
# <Area> handoff
## Plan
## Built (what exists and where)
## How it plugs in (FeatureModule entries, services, extension points used)
## Decisions (and why)
## Contract change requests (exact proposed diff to packages/core, and why)
## Known gaps and bugs
## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)
## Screenshots (list of files)
```

## Contract change requests

`packages/core` belongs to the Architect. If you need something it doesn't offer:

1. Keep going with a local workaround inside your own folders, so your branch builds and its tests
   pass on their own.
2. Add a request under *Contract change requests* with:
   - the file and the exact diff (before and after), in a fenced `diff` block;
   - why you need it, and which alternatives you considered;
   - the workaround you used, and what to delete once the change lands.
3. The Architect applies approved changes first thing at merge time, in one commit, and records
   every verdict in `integration.md`.

## Follow-ups for the merge

List every piece of cross-agent wiring you couldn't finish alone, one bullet each, specific enough
that someone else can do it: which files, which contract, and how to check it works (for example,
"register the editor as the history panel's preview: `packages/sync/src/history/Preview.tsx`
renders `DocJSON` as plain text until then; replace it with the editor's read-only view").
