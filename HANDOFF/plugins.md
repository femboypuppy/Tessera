# Plugins handoff

## Plan

Milestones (each ends tested and committed):

1. **SDK** (`packages/plugin-api`): the typed API (`definePlugin`, `PluginApi`, panel and block
   contexts, settings schema, errors), and a test harness with a mocked API that enforces
   permissions like the host (`@tessera/plugin-api/testing`).
2. **Host core** (`packages/plugins`): manifest and bundle parsing (zip, folder, URL), plugin
   stores (IndexedDB, memory), the plugin manager (install, enable, disable, update, uninstall,
   grant and revoke), the RPC protocol with zod validation, size limits and permission checks on
   every call, and the capability-scoped API handlers on top of `AppContext`. Lifecycle and fuzz
   tests.
3. **Sandbox and runtime**: sandboxed iframes (`allow-scripts` only) with a strict CSP; plugin logic
   in a Worker inside the sandbox with a heartbeat watchdog; panels and blocks in nested sandboxed
   frames; the per-session plugin host; the feature module (settings panel, `plugin:` block
   renderer, runtime commands, panels and slash-menu items).
4. **Host UI**: Settings → Plugins (installed list, permissions, settings form, console,
   uninstall), install from zip, folder and URL with a plain-language permission prompt, the
   registry browser, dev mode with live reload.
5. **Example plugins** (`examples/plugins`): word count, daily notes, pomodoro, random page,
   mermaid; each with a README and tests; a build script and `registry.json`.
6. **Tooling**: `create-tessera-plugin` and `examples/plugin-template` (kept identical by a test).
7. **e2e and screenshots** (`e2e/plugins`): install flows, sandbox escape attempts, the infinite
   loop watchdog, permission revocation; screenshots in both themes.
8. **Docs** (`docs/plugins`): getting started, API reference generated from TSDoc, permissions and
   security model, publishing.

## Built (what exists and where)

In progress.

## How it plugs in (FeatureModule entries, services, extension points used)

In progress.

## Decisions (and why)

- **Spike results (before any code), Playwright 1.63, Chromium 1243 and Firefox 1543:**
  - A sandboxed `srcdoc` iframe (`allow-scripts`, no `allow-same-origin`) can start a **classic**
    Worker from a blob URL in both browsers, and `import()` a blob ES module inside it. **Module**
    workers from blob URLs never start in Chromium (no error event), so plugin logic runs in a
    classic worker that imports the plugin's ES module.
  - Inside the worker: IndexedDB throws `SecurityError`, fetches to domains outside `connect-src`
    are blocked by the CSP inherited from the frame, and a `while (true) {}` stops heartbeats while
    the app's main thread keeps running (29–30 timer ticks in 1.5 s in both browsers).
  - A plugin running in a sandboxed frame can **navigate its own frame** (`location.href`, link
    clicks, `location.replace`, meta refresh) and leak data in the URL; the Navigation API cannot
    stop it (disabled for opaque origins). Fix: UI surfaces use **nested** frames. A trusted outer
    frame (CSP `frame-src 'none'`) hosts an inner frame that runs plugin code, and the outer
    frame's `frame-src` blocks every navigation of the inner frame. Verified against a local
    "evil" server: zero requests from 16 exfiltration attempts in both browsers.
  - Plugin code that loops forever **in a UI frame** freezes the app in Firefox and headless
    Chromium (same process); headful Chromium isolates sandboxed frames in their own process and
    stays responsive.

## Contract change requests (exact proposed diff to packages/core, and why)

None yet.

## Known gaps and bugs

In progress.

## Follow-ups for the merge (cross-agent wiring you couldn't finish alone)

In progress.

## Screenshots (list of files)

In progress.
