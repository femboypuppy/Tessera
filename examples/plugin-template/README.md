# My plugin

A [Tessera](https://github.com/femboypuppy/Tessera) plugin, made with `pnpm create tessera-plugin`.

It adds a **Say hello** command to the command palette and a side panel that shows the page you
are on. Change it into anything: the API is in the
[plugin docs](https://github.com/femboypuppy/Tessera/tree/main/docs/plugins).

## Develop

```sh
pnpm install
pnpm dev
```

`pnpm dev` rebuilds on every save and serves the plugin at `http://localhost:5199/`. In Tessera,
open **Settings → Plugins → Install plugin → Load a dev plugin** and connect to that address:
Tessera installs the plugin and reloads it each time you save.

## Test

```sh
pnpm test
```

`src/main.test.ts` runs the plugin against the SDK's test harness: an in-memory workspace that
checks permissions the way Tessera does.

## Ship

```sh
pnpm pack
```

This writes `my-plugin-0.1.0.zip`, which anyone can install with **Install plugin → From a file**.
To list it in a registry, see
[Publishing](https://github.com/femboypuppy/Tessera/blob/main/docs/plugins/publishing.md).

## Files

| File | What it is |
|---|---|
| `manifest.json` | ID, name, version, author, permissions. Tessera shows the permissions before installing. |
| `src/main.ts` | The plugin: `definePlugin({ activate, panels, blocks, settings })`. |
| `src/main.test.ts` | Tests with a mocked API. |
| `vite.config.ts` | Builds one file, `dist/main.js`, next to the manifest. |
| `scripts/dev.mjs` | The dev server for live reload. |
| `scripts/pack.mjs` | Zips `dist/` for sharing. |
