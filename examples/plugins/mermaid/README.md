# Mermaid diagrams

Type `/mermaid` in a page to insert a diagram written in [Mermaid](https://mermaid.js.org):
flowcharts, sequence diagrams, timelines (Gantt), class and state diagrams, pie charts and mind
maps. Click **Edit** for a live preview next to the source; `Mod+Enter` or `Esc` closes the
editor. Diagrams follow the app’s light and dark theme.

![A Mermaid diagram block](../../../assets/screenshots/plugins/mermaid-block-light.png)

## Permissions

| Permission | Why |
|---|---|
| `ui:blocks` | To add the diagram block. |

That’s all: the diagram’s source is saved in the page (the block’s data), so it syncs, exports
and works offline. The plugin can’t read other pages or reach the internet; Mermaid is bundled.

## How it works

- `activate` registers the block with `api.ui.addBlock`, which puts it in the slash menu with a
  starting diagram (`initialData`).
- `blocks.diagram` renders each block in its own sandboxed frame (`src/block.ts`). It saves edits
  with `ctx.setData({ code })` and follows undo and collaborators with `ctx.onChange`.
- `src/render.ts` turns Tessera’s design tokens (`api.theme`) into Mermaid theme variables.
- The build inlines Mermaid into one file (`codeSplitting: false` in `vite.config.ts`), because a
  plugin loads from a single module.

## Develop

```sh
pnpm install
pnpm test    # the renderer is mocked: jsdom can't lay out SVG
pnpm build
```
