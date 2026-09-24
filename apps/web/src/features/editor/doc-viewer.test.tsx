import { build } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { createTestAppContext, kitchenSinkDoc } from '@tessera/core/testing';
import { TooltipProvider } from '@tessera/ui';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { editorFeature } from './index';

describe('the editor as a document viewer', () => {
  it('is registered for previews and shows a document read-only, following new versions', async () => {
    const test = await createTestAppContext({ features: [editorFeature] });
    const [viewer] = test.ctx.contributions.list('docViewers');
    expect(viewer?.featureId).toBe('editor');
    const { default: DocViewer } = await import('@tessera/editor/doc-viewer');
    const page = test.ctx.workspace.createPage({ title: 'Flight plan' });
    const view = render(
      <AppContextProvider value={test.ctx}>
        <TooltipProvider>
          <DocViewer doc={kitchenSinkDoc()} pageId={page.id} />
        </TooltipProvider>
      </AppContextProvider>,
    );
    const document = await screen.findByRole('document', { name: 'Page content (read-only)' });
    expect(document).toHaveAttribute('contenteditable', 'false');
    // The same blocks as the page: a table, a task list and highlighted code.
    expect(document.querySelector('table')).not.toBeNull();
    expect(document.querySelector('ul[data-type="taskList"]')).not.toBeNull();
    expect(document.querySelector('pre')).not.toBeNull();

    view.rerender(
      <AppContextProvider value={test.ctx}>
        <TooltipProvider>
          <DocViewer doc={build.doc(build.heading(2, 'Another version'))} pageId={page.id} />
        </TooltipProvider>
      </AppContextProvider>,
    );
    expect(await screen.findByRole('heading', { name: 'Another version' })).toBeInTheDocument();
    expect(document.querySelector('table')).toBeNull();
    view.unmount();
    await test.dispose();
  });
});
