# @tessera/testkit

Test tooling for every Tessera package: a deterministic workspace generator, in-memory and seeded
runtimes, React render helpers, Playwright fixtures, and a seeded copy of the web app for
end-to-end tests and benchmarks.

## Generate a workspace

```ts
import { generateWorkspace } from '@tessera/testkit';

const workspace = generateWorkspace({ seed: 42, pages: 5000, databases: 3, largePages: [2000] });
workspace.pages; // plans: titles, tree, roles (page, database, row, large), tags, aliases
workspace.workspaceDoc(); // Y.Doc for `ws:<id>`, built with the core helpers
workspace.pageDoc(pageId); // Y.Doc for `page:<id>` (null for databases)
workspace.databaseDoc(databaseId); // schema, five views, rows
workspace.markdownFiles(); // [{ path, content }]: an Obsidian-style vault with CSV databases
```

The same options always give the same workspace, byte for byte. Content reads like real notes
(six topics, no lorem ipsum): nested pages, `[[links]]` with a power-law distribution (so graphs
look real), tags, tasks, tables, callouts, toggles, code, and databases with every property type
(but the reserved `formula`) and every view type. Options: `seed`, `pages`, `databases`,
`rowsPerDatabase`, `maxDepth`, `linksPerPage`, `largePages`, `trashed`, `now`, `folder`.

## Runtimes

```ts
import { createSeededAppContext, createTestRuntime } from '@tessera/testkit/runtime';

const { ctx, generated, dispose } = await createSeededAppContext({ seed: 1, pages: 500, features: [searchFeature] });
const { hits } = await ctx.services.searchIndex.query(generated.pages[0].title);
await dispose();
```

`seedFeature(generated)` is the piece that does it: a feature whose services (a workspace registry
and a doc store at priority 1000) serve the generated workspace to any runtime.

## React (jsdom)

```tsx
// @vitest-environment jsdom
import '@tessera/core/testing/setup-dom';
import { renderWithApp } from '@tessera/testkit/react';

const view = await renderWithApp(<BacklinksPanel pageId={id} />, { seed: { pages: 50 }, features: [backlinksFeature] });
expect(await view.findByText('Linked references')).toBeVisible();
await view.dispose();
```

## Playwright

Import from `e2e/support` (it re-exports `@tessera/testkit/playwright`):

```ts
import { expect, test } from '../support';

test('search finds a page', async ({ freshWorkspace: app }) => {
  await app.expectFeatures('search'); // fails with what's missing and who builds it
  // …
});

test.use({ seedOptions: { seed: 7, pages: 300 } });
test('a seeded workspace', async ({ seededWorkspace: { app, state } }) => {
  await app.openPage(state.pages[0].title);
});
```

Fixtures: `app`, `freshWorkspace`, `seededWorkspace` (+ `seedOptions`), `syncServer` (a real
server on a free port), `collaborators` (two users and the server). Helpers: `scanAccessibility`,
`formatViolations`, `writeZip`, `readZip`, `readDiagnostics`, `startHarness`.

## The seeded harness

`harness/` is the real web app (the shell and every registered feature) plus `seedFeature`:
`pnpm --filter @tessera/testkit harness` serves it; open `/?seed=42&pages=5000`.
`window.__tesseraHarness` exposes timings, the generated page list and the `AppContext`. The
benchmarks (`scripts/bench`) and the `seededWorkspace` fixture use it.
