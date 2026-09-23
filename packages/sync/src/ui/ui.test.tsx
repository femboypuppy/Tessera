import 'fake-indexeddb/auto';
import { Awareness, build } from '@tessera/core';
import { AppContextProvider } from '@tessera/core/react';
import { createTestAppContext, kitchenSinkDoc } from '@tessera/core/testing';
import { TooltipProvider } from '@tessera/ui';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocPreview } from './history/DocPreview';
import { peopleFrom } from './PresenceAvatars';
import { describeUserAgent } from './settings/ConnectedWorkspace';
import { SyncStatusIndicator } from './SyncStatusIndicator';

async function withContext(ui: ReactNode) {
  const test = await createTestAppContext();
  const view = render(
    <AppContextProvider value={test.ctx}>
      <TooltipProvider>{ui}</TooltipProvider>
    </AppContextProvider>,
  );
  return { ...test, view };
}

describe('SyncStatusIndicator', () => {
  it('shows a local-only workspace and offers to connect it', async () => {
    const user = userEvent.setup();
    const { shell, dispose } = await withContext(<SyncStatusIndicator />);
    const button = screen.getByRole('button', { name: 'Sync status: Local only' });
    await user.click(button);
    expect(await screen.findByText(/lives on this device/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Connect to a server' }));
    expect(shell.navigations).toContainEqual({ path: '/settings/sync' });
    await dispose();
  });
});

describe('presence', () => {
  it('lists other people once each, never yourself', () => {
    const doc = new Y.Doc();
    const awareness = new Awareness(doc);
    awareness.setLocalStateField('user', { id: 'me', name: 'Me', color: '#000000' });
    const remote = (clientId: number, user: unknown) =>
      awareness.states.set(clientId, { user } as Record<string, unknown>);
    remote(101, { id: 'ada', name: 'Ada', color: '#e5484d' });
    remote(102, { id: 'ada', name: 'Ada (tab 2)', color: '#e5484d' });
    remote(103, { id: 'grace', name: '', color: null });
    remote(104, { id: 'me', name: 'Me on my phone', color: '#000000' });
    remote(105, 'garbage');
    const people = peopleFrom(awareness, 'me');
    expect(people.map((person) => person.id)).toEqual(['ada', 'grace']);
    expect(people.find((person) => person.id === 'grace')).toMatchObject({ name: 'Someone' });
    expect(people.find((person) => person.id === 'grace')?.color).toMatch(/^#/);
  });
});

describe('DocPreview', () => {
  it('renders every node of a version read-only', async () => {
    const { view, dispose } = await withContext(<DocPreview doc={kitchenSinkDoc()} />);
    expect(view.container.querySelector('h3')).toHaveTextContent(/Apollo 11/);
    expect(view.container.querySelector('pre code')).not.toBeNull();
    expect(view.container.querySelector('table')).not.toBeNull();
    expect(view.container.querySelectorAll('input[type="checkbox"]').length).toBeGreaterThan(0);
    for (const input of view.container.querySelectorAll('input')) expect(input).toBeDisabled();
    await dispose();
  });

  it('never renders unsafe links', async () => {
    const doc = build.doc(
      build.p(build.text('safe', build.mark.link('https://example.com')), build.text(' and '), {
        type: 'text',
        text: 'unsafe',
        marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)', title: null } }],
      }),
    );
    const { view, dispose } = await withContext(<DocPreview doc={doc} />);
    const links = within(view.container).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute('href', 'https://example.com');
    expect(links[0]).toHaveAttribute('rel', 'noopener noreferrer');
    expect(view.container.innerHTML).not.toContain('javascript:');
    await dispose();
  });

  it('says when a version is empty', async () => {
    const { dispose } = await withContext(<DocPreview doc={build.doc()} />);
    expect(screen.getByText('This version is empty.')).toBeInTheDocument();
    await dispose();
  });
});

describe('devices', () => {
  it('describes browsers from their user agent', () => {
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
      ),
    ).toBe('Chrome · Windows');
    expect(
      describeUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0; rv:130.0) Gecko/20100101 Firefox/130.0',
      ),
    ).toBe('Firefox · macOS');
    expect(describeUserAgent(null)).toBeNull();
  });
});
