// @vitest-environment jsdom
import '@tessera/core/testing/setup-dom';
import { COMMANDS } from '@tessera/core';
import { useAppContext, usePages } from '@tessera/core/react';
import { toast } from '@tessera/ui';
import { act, screen } from '@testing-library/react';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { renderWithApp } from './index';

function PageList() {
  const pages = usePages();
  const location = useLocation();
  return (
    <div>
      <p>Path: {location.pathname}</p>
      <ul aria-label="Pages">
        {pages.tree().map((node) => (
          <li key={node.page.id}>{node.page.title}</li>
        ))}
      </ul>
    </div>
  );
}

function Workspace() {
  const ctx = useAppContext();
  return <p>Workspace: {ctx.workspace.info.name}</p>;
}

describe('renderWithApp', () => {
  it('renders with the app context, a router and an empty workspace', async () => {
    const view = await renderWithApp(
      <>
        <Workspace />
        <PageList />
      </>,
      { path: '/p/123' },
    );
    try {
      expect(screen.getByText('Workspace: Test workspace')).toBeInTheDocument();
      expect(screen.getByText('Path: /p/123')).toBeInTheDocument();
      act(() => {
        view.ctx.workspace.createPage({ title: 'Launch plan' });
      });
      expect(await screen.findByText('Launch plan')).toBeInTheDocument();
      expect(view.ctx.commands.has(COMMANDS.newPage)).toBe(false);
    } finally {
      await view.dispose();
    }
  });

  it('renders a seeded workspace', async () => {
    const view = await renderWithApp(<PageList />, { seed: { seed: 2, pages: 25 } });
    try {
      const firstTopLevel = view.ctx.workspace.pages.getSnapshot().tree()[0]?.page.title ?? '';
      expect(screen.getByText(firstTopLevel)).toBeInTheDocument();
      expect(screen.getByRole('list', { name: 'Pages' }).children.length).toBeGreaterThan(2);
    } finally {
      await view.dispose();
    }
  });

  it('mounts the toaster', async () => {
    const view = await renderWithApp(<p>Body</p>);
    try {
      act(() => {
        toast({ title: 'Saved the draft' });
      });
      expect(await screen.findByText('Saved the draft')).toBeInTheDocument();
    } finally {
      await view.dispose();
    }
  });
});
