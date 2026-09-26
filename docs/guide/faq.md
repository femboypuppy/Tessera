# FAQ

## Is Tessera free?

Yes. Tessera is open source under the [MIT license](https://github.com/femboypuppy/Tessera-Notes/blob/main/LICENSE).
There's no paid plan, no account with us and no telemetry. Running a server costs whatever your
hosting costs.

## Where is my data?

On your device: in a folder you choose (desktop app) or in the browser's storage (web app). If you
connect a server, a copy lives on that server too, which you run. See
[Sync and collaboration](./sync-and-collaboration#how-your-data-is-stored).

## Do I need a server?

No. Tessera works fully offline on one device. You need a server only to sync devices or to work
with other people. It's [one container](../self-hosting/).

## Is there a hosted version?

No. Tessera is built for you to own your data, so there is no Tessera cloud. A small VPS runs the
server comfortably, and [the self-hosting guide](../self-hosting/) takes a few minutes.

## Is my data encrypted?

Traffic between the apps and your server is encrypted with HTTPS. Data at rest is stored as-is on
your device and your server; protect them with disk encryption. End-to-end encryption is on the
[roadmap](https://github.com/femboypuppy/Tessera-Notes#roadmap).

## Can I use my Obsidian vault directly?

Tessera imports vaults rather than editing the files in place: documents live in a database so
that sync and collaboration can merge edits safely. You can [export](./import-export) back to
Obsidian-compatible markdown at any time, and the desktop app can keep a live
[markdown copy](./desktop#markdown-copy) of each workspace.

## Is there a mobile app?

Not yet. The web app works on phones and tablets, with a touch-friendly layout at phone width.
Native apps are on the roadmap.

## Can I share a page publicly?

Not in 0.1. Sharing works through your server: invite people to the workspace as editors or
viewers.

## How do plugins stay safe?

Each plugin runs in its own sandboxed iframe with no access to the app, your storage or your
cookies. It can only call the APIs for the permissions you approved when you installed it, and you
can revoke them at any time. The plugin docs cover the security model in detail.

## How is Tessera different from Notion, Obsidian, Anytype, AFFiNE or Logseq?

The [README](https://github.com/femboypuppy/Tessera-Notes#how-tessera-compares) has a comparison table,
checked against each product's own docs. In short: Tessera is MIT-licensed, local-first,
self-hostable in one container, and has real-time collaboration, databases, plugins and a graph
together. It is also much younger than all of them.

## How can I help?

Star the repo, tell a friend, report bugs, or pick a
[good first issue](https://github.com/femboypuppy/Tessera-Notes/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22).
[Contributing](../contributing/) explains how to get started.
