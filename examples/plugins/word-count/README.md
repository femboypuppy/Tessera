# Word count

A side panel with the words, characters and reading time of the page you are on. It updates as you
type and when you open another page. Set a word goal in its settings to see a progress bar.

## Permissions

| Permission | Why |
|---|---|
| `pages:read` | To read the text of the open page. |
| `ui:panels` | To show its panel. |

It can't change your pages, store anything, or reach the internet.

## Settings

- **Word goal**: shows progress towards a number of words on every page. `0` turns it off.

## How it works

- `src/stats.ts` strips markdown syntax and counts words with `Intl.Segmenter`, so it counts
  correctly in languages without spaces between words. Reading time uses 238 words per minute.
- `src/main.ts` adds the panel in `activate` and renders it in `panels.count`, which runs in the
  panel's own sandboxed frame. It follows `ctx.onPageChange` and `api.pages.onChange`.

## Develop

```sh
pnpm install
pnpm test     # runs src/*.test.ts against the SDK's test harness
pnpm build    # writes dist/: manifest.json, main.js, README.md
```

Install `dist/` in Tessera with Settings → Plugins → Install plugin → From a folder.
