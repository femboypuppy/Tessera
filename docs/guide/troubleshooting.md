# Troubleshooting

Something not working? Start here. If your problem isn't listed,
[open an issue](https://github.com/femboypuppy/Tessera/issues/new/choose) with the details from
**Diagnostics** below.

## Diagnostics

In the browser's developer console, `window.__tessera.diagnostics()` lists the loaded features and which storage, sync and search
engines are active. It contains names only, never your content, so it's safe to paste into a bug
report.

## Sync

**The indicator says "Offline" but I'm online.**
Check that the server address in **Settings → Sync & account** is right and that
`https://<your-server>/api/health` answers `{"ok":true,…}` in a browser. Behind a reverse proxy,
make sure WebSocket upgrades are forwarded (see [HTTPS and reverse proxies](../self-hosting/https)).

**The indicator shows "Sync paused".**
Click it to see the reason. "Unauthorized" means your session expired: sign in again. Your local
edits are kept and sync once you're back.

**A change I made on another device hasn't arrived.**
Both devices need to be online at some point, and the other device must have finished syncing
(its indicator says "Synced"). Changes are never lost; they wait on the device that made them.

## Storage

**"Storage is full" in the browser.**
The browser gave Tessera no more space. Free some disk space, or delete large attachments you no
longer need, then empty the trash. For big workspaces, the desktop app has no such limit.

**My browser workspace disappeared.**
Browsers delete site data when you clear your history or use a private window. If the workspace
synced to a server, open it again from **Settings → Sync & account**. Otherwise restore your last
[JSON backup](./import-export#backups).

## Desktop app

**macOS says the app is damaged or from an unidentified developer.**
Download it again from the [releases page](https://github.com/femboypuppy/Tessera/releases/latest)
and compare the checksum. If the release notes say that build isn't signed yet, right-click the
app, choose **Open**, and confirm.

**"Conflicted copy" warning.**
Your workspace folder is inside a file-sync service (Dropbox, iCloud Drive, OneDrive…) that saw
two versions of the database. Move the workspace out of the synced folder and connect it to a
Tessera server instead. See [The desktop app](./desktop#workspaces-are-folders).

**Quick capture doesn't open.**
Another app may already use <kbd>Mod</kbd>+<kbd>Shift</kbd>+<kbd>Space</kbd>. Quit that app or
change its shortcut, then restart Tessera.

## Import

**Links didn't resolve after an Obsidian import.**
The import report lists every unresolved link with the page it's on. Usually the target note
wasn't in the imported folder. Import the whole vault rather than a subfolder.

**A Notion database came in as plain pages.**
Export from Notion as **Markdown & CSV** (not HTML), with subpages included, and import the whole
zip.

## Plugins

**A plugin says "Permission denied".**
The plugin asked for something you haven't allowed, or you revoked a permission. Open **Settings →
Plugins**, check its permissions, and look at its console for details.

**A plugin stopped responding.**
Tessera stops plugins that hang, so the app keeps working. Disable and re-enable the plugin, and
report the problem to its author with the console output.

## Server

See [Self-hosting](../self-hosting/) for the logs, health checks and common configuration
mistakes. Most server problems are a missing `PUBLIC_URL` or a proxy that doesn't forward
WebSockets.
