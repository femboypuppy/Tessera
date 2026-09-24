# Daily notes

One note per day. Run **Daily notes: Open today’s note** (`Mod+Alt+D`) from the command palette:
the plugin finds today’s note, or creates it from your template inside a folder page, and opens
it. There are commands for yesterday and tomorrow too.

## Permissions

| Permission | Why |
|---|---|
| `pages:read` | To find the folder page and today’s note. |
| `pages:write` | To create them. |
| `ui:commands` | To add its commands. |

## Settings

- **Date format**: how notes are titled, with tokens (`YYYY-MM-DD` by default):
  `YYYY` 2026, `YY` 26, `MMMM` September, `MMM` Sep, `MM` 09, `M` 9, `DD` 03, `D` 3, `Do` 3rd,
  `dddd` Thursday, `ddd` Thu. Text in `[brackets]` stays as is: `[Week of] MMMM D`.
- **Folder page**: the page daily notes go under (`Daily notes`). Empty keeps them at the top level.
- **Template**: the markdown a new note starts with.
- **Create today’s note when Tessera opens**: creates it in the background at startup.

## How it works

`src/dates.ts` formats dates; `src/main.ts` registers the commands and, when `autoCreate` is on,
creates the note in `activate`. It reads its settings with `api.settings.get`, lists pages with
`api.pages.list({ parentId })` and creates notes with markdown content through `api.pages.create`.

## Develop

```sh
pnpm install
pnpm test
pnpm build   # dist/ is the installable plugin
```
