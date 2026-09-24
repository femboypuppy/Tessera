# Random page

Run **Random page: Open a random page** from the command palette to jump to a page you haven’t
seen in a while. It never picks the page you’re on, nor pages in the trash.

## Permissions

| Permission | Why |
|---|---|
| `pages:read` | To list your pages and open one. |
| `ui:commands` | To add its command. |

## Settings

- **Include database rows**: rows are pages too; off by default.
- **Include databases**: on by default.

## How it works

The whole plugin is one command in `src/main.ts`. `pickRandomPage` is a pure function with a
replaceable random source, so the tests are deterministic.

## Develop

```sh
pnpm install
pnpm test
pnpm build
```
