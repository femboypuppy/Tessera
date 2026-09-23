# Agent 06 — Plugin system

**Parallel phase, branch `feat/plugins`. Effort: xhigh.**

You own `packages/plugins`, `packages/plugin-api`, `packages/create-tessera-plugin`, `apps/web/src/features/plugins`, `examples/plugins`, `examples/plugin-template`, `docs/plugins`, and your HANDOFF, screenshot and e2e folders.

## Why this matters

A plugin ecosystem is how Obsidian won, and plugin authors become a project's loudest fans. Writing a Tessera plugin must be delightful, and running a stranger's plugin must be safe.

## Read first

`CLAUDE.md`, `SPEC.md`, `HANDOFF/architect.md`, and in `packages/core`: `PluginManifest` and the permission names, `BlockRendererRegistry`, `CommandRegistry`, `FeatureModule`, `AppContext`, the database types and `DocJSON`.

## Security model (non-negotiable)

- Plugin code never runs in the app's JavaScript realm. Each plugin runs in its own sandboxed iframe (`sandbox="allow-scripts"`, **without** `allow-same-origin`, so it gets an opaque origin and no access to the app's storage or cookies) with a strict Content Security Policy. Network access is blocked unless the plugin holds the `network` permission, and even then only to its declared domains.
- Prefer running plugin logic in a Worker inside the sandbox, so a runaway plugin can be terminated by a heartbeat watchdog without freezing the app. Verify this works in Chromium and Firefox. If it doesn't, document the fallback and its limits.
- UI surfaces (panels and custom blocks) render in their own sandboxed iframes.
- Communication happens only through a typed postMessage RPC. The host validates every message with zod and checks permissions on **every** call. Plugins receive capability-scoped APIs, never raw Y.Docs.
- Permissions come from the manifest (`pages:read`, `pages:write`, `databases:read`, `databases:write`, `ui:commands`, `ui:panels`, `ui:blocks`, `storage`, `network:<domain>`). The user approves them on install and can revoke them later. Calls without permission reject with a clear error.
- Crashes, exceptions and timeouts are caught and shown in a per-plugin console. They never crash the app.

## Plugin SDK (`packages/plugin-api`)

- A small typed SDK: `definePlugin({ activate(api) { … }, deactivate() { … } })`.
- The API:
  - `api.commands.register`
  - `api.ui.addPanel`
  - `api.ui.addBlock`: a custom `embed` kind `plugin:<id>/<type>`, with its data stored in the node, auto-resizing to its content
  - `api.ui.notify`
  - `api.pages.list`, `get`, `create`, `update` and `onChange` (content as markdown or `DocJSON`)
  - `api.databases.query`, `addRow` and `updateRow`
  - `api.storage.get`, `set` and `delete` (private to the plugin)
  - `api.settings`: a declarative schema that generates the settings UI
  - `api.theme`: the current tokens, so plugin UIs match the app
- `apiVersion` in the manifest, so future API changes don't break old plugins.

## Host UI

- Settings → Plugins: the installed list with enable/disable, permissions, settings, console, and uninstall (which also clears the plugin's storage).
- Install from a zip file, a local folder (File System Access API where supported) or a URL. The permission prompt lists what the plugin can do in plain language.
- **Community registry:** define a `registry.json` format (id, name, author, description, repo, version, download URL, permissions) and a browse-and-search UI that reads it from a configurable URL. Ship an example registry file listing the example plugins.
- **Dev mode:** load a plugin from a local dev-server URL with live reload, for plugin authors.

## Example plugins (`examples/plugins`, each with a README and tests)

1. Word count panel.
2. Daily notes: a command, optional auto-create on startup, and a date-format setting.
3. Pomodoro timer panel.
4. Random page command.
5. Mermaid diagram block: a custom block rendered inside the plugin's iframe. It shows off custom blocks, so make it look great.

## Plugin tooling

- `packages/create-tessera-plugin`: `pnpm create tessera-plugin my-plugin` scaffolds a manifest, source, a Vite library build (single bundle), a test harness with a mocked API, and a README.
- `examples/plugin-template`: the same template as a standalone folder people can copy.

## Docs (`docs/plugins/`)

Getting started (hello world in five minutes), an API reference generated from TSDoc, the permissions and security model, and publishing to the registry. Agent 10 links these pages from the main docs sidebar.

## Acceptance criteria

- Sandbox escape tests: a malicious test plugin tries to read `parent`, `top`, cookies, `localStorage` and IndexedDB, to fetch a non-allowlisted domain, and to call APIs without permission. All attempts are blocked.
- RPC fuzz tests with malformed, oversized and out-of-order messages.
- Lifecycle tests: install, enable, disable, update, uninstall (storage cleared), revoke a permission.
- A plugin stuck in an infinite loop is detected and stopped while the app stays responsive. If the platform can't do that, the limitation is documented with evidence.
- e2e in `e2e/plugins/`: install Word count and see its panel; install the Mermaid block, insert it from the slash menu and see it render; revoke a permission and see a friendly error.
- Screenshots (light and dark): `plugin-settings`, `permission-prompt`, `mermaid-block`, `pomodoro`, `registry`.

## Pitfalls

- `allow-scripts` and `allow-same-origin` together defeat the sandbox. Never combine them.
- Validate on the host side, not just in the SDK. The SDK is a convenience; the host is the security boundary.
