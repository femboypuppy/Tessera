import {
  build as b,
  defineFeature,
  defineService,
  SERVICE_PRIORITY,
  setPageProps,
  writeDocJSON,
  type DocJSON,
  type JsonValue,
} from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { createTestAppContext, type TestAppContext } from '@tessera/core/testing';
import { TooltipProvider } from '@tessera/ui';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryPersistence } from './engine/persistence';
import { InProcessTransport } from './engine/transport';
import {
  createLinkIndex,
  createSearchIndex,
  type GraphLinkIndex,
  type MiniSearchIndex,
} from './services';

/** A feature that installs our indexes on an in-process transport (tests have no workers). */
export function indexFeature(persistence = new MemoryPersistence()) {
  const transport = () => new InProcessTransport({ persistence, saveDelayMs: 5 });
  return defineFeature({
    id: 'search-test',
    services: [
      defineService({
        provides: 'searchIndex',
        id: 'minisearch',
        priority: SERVICE_PRIORITY.browser,
        create: (context) => createSearchIndex(context, { transport }),
      }),
      defineService({
        provides: 'linkIndex',
        id: 'graph',
        priority: SERVICE_PRIORITY.browser,
        create: (context) => createLinkIndex(context, { transport }),
      }),
    ],
  });
}

export interface IndexedTestContext extends TestAppContext {
  search: MiniSearchIndex;
  links: GraphLinkIndex;
  /** Writes content (and page props) and waits until the indexes caught up. */
  write(pageId: string, doc: DocJSON, props?: Record<string, JsonValue>): Promise<void>;
  /** Renders UI inside the session's AppContext. */
  renderInApp(ui: ReactNode): ReturnType<typeof render>;
}

/** A workspace session with our indexes, plus helpers. Dispose it with `dispose()`. */
export async function createIndexedContext(): Promise<IndexedTestContext> {
  const test = await createTestAppContext({ features: [indexFeature()] });
  const search = test.ctx.services.searchIndex as MiniSearchIndex;
  const links = test.ctx.services.linkIndex as GraphLinkIndex;
  return {
    ...test,
    search,
    links,
    async write(pageId, doc, props) {
      const handle = await test.ctx.loadPageDoc(pageId);
      handle.doc.transact(() => {
        writeDocJSON(handle.doc, doc);
        if (props) setPageProps(handle.doc, props);
      });
      handle.release();
      await test.flush();
      await search.whenIdle();
    },
    renderInApp(ui) {
      return render(
        <AppContextProvider value={test.ctx}>
          <TooltipProvider>{ui}</TooltipProvider>
        </AppContextProvider>,
      );
    },
  };
}

export { b };
