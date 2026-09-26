# What is Tessera?

Tessera is an open-source knowledge app for notes, docs, wikis and project tracking. It combines
Notion-style blocks and databases with Obsidian-style `[[wikilinks]]`, backlinks and a graph, and
it adds real-time collaboration and sandboxed plugins.

It is **local-first**: the app keeps your workspace on your device and works fully offline. A
server is optional. When you want to sync devices or work with other people, you run the Tessera
server yourself, in one container.

<Screenshot name="architect/shell" alt="A Tessera workspace with nested pages, favorites, an icon and a cover" />

## What you can do with it

- **Write** in a block editor with a slash menu, markdown shortcuts, tables, callouts, toggles,
  code blocks, images and embeds. See [The editor](./editor).
- **Organize** anything in [databases](./databases) with table, board, calendar, gallery and list
  views.
- **Connect** ideas with [links, backlinks and the graph](./links-and-graph).
- **Find** any page, block, tag or command with the [command palette](./search).
- **Collaborate** in real time on your own server, with presence and version history. See
  [Sync and collaboration](./sync-and-collaboration).
- **Move in and out**: [import](./import-export) Notion exports, Obsidian vaults and markdown
  folders, and export to markdown, HTML, PDF or a full backup.
- **Extend** it with plugins that run in a sandbox and ask for permission first.

## Principles

**Your data is yours.** The real copy of your workspace lives on your device. If you connect a
server, it is your server. There is no Tessera cloud.

**Never lose data.** Every edit is saved locally before anything else happens. Sync uses CRDTs
([Yjs](https://github.com/yjs/yjs)), so edits made offline or by several people at once merge
without conflicts. Deleting is undoable or confirmed.

**No lock-in.** Everything exports to plain markdown that Obsidian and other tools read.

**Fast and calm.** Instant startup, no layout shift, and a quiet interface that stays out of your
way.

**Safe to extend.** Plugins run in sandboxed iframes and can only use the permissions you grant.

## Where it runs

| Where                 | What you get                                                       | Guide                                        |
| --------------------- | ------------------------------------------------------------------ | -------------------------------------------- |
| Desktop app           | macOS, Windows and Linux. Each workspace is a folder you choose.   | [Installation](./installation#desktop-app)   |
| Your own server       | The web app plus sync for your team, from one Docker container.    | [Self-hosting](../self-hosting/)             |
| Any modern browser    | The web app served by your server, with offline storage.           | [Installation](./installation#web-app)       |

## What Tessera doesn't do (yet)

Tessera 0.1 has no native mobile apps (the web app works at phone width), no end-to-end
encryption, no public page sharing or per-page permissions, no comments, and no AI features. The
[roadmap](https://github.com/femboypuppy/Tessera-Notes#roadmap) lists what comes next.

Ready? [Install Tessera](./installation), then take the [first steps](./first-steps).
